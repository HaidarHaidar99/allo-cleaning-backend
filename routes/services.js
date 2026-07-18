const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

// Ensure uploads folder exists
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION || __dirname.includes('/var/task');
const uploadsDir = isServerless ? path.join('/tmp', 'uploads') : path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Multer Upload Middleware
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only images (jpg, jpeg, png, webp, gif) are allowed!'));
    }
  }
});

// Helpers to delete local file
const deleteLocalFile = (filepath) => {
  if (!filepath) return;
  // Convert URL path back to absolute system path if it starts with /uploads/
  if (filepath.startsWith('/uploads/')) {
    const localPath = isServerless ? path.join('/tmp', filepath) : path.join(__dirname, '..', filepath);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch (err) {
        console.error(`Failed to delete local file: ${localPath}`, err.message);
      }
    }
  }
};

// Route 1: Get all services (Public)
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('services').get();
    const services = [];
    snapshot.forEach(doc => {
      services.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json(services);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Failed to fetch services.' });
  }
});

// Route 2: Get single service (Public)
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('services').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Service not found.' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ message: 'Failed to fetch service.' });
  }
});

// Route 3: Add new service (Admin only)
router.post('/', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !description) {
      // If file was uploaded, clean it up since validation failed
      if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
      return res.status(400).json({ message: 'Name and description are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Service image file is required.' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    const serviceData = {
      name: name.trim(),
      description: description.trim(),
      imageUrl,
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('services').add(serviceData);
    
    res.status(201).json({
      message: 'Service created successfully.',
      service: { id: docRef.id, ...serviceData }
    });

  } catch (error) {
    console.error('Error adding service:', error);
    if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
    res.status(500).json({ message: 'Failed to create service.' });
  }
});

// Route 4: Edit service (Admin only)
router.put('/:id', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const docId = req.params.id;

    // Check if service exists
    const docRef = db.collection('services').doc(docId);
    const serviceDoc = await docRef.get();
    if (!serviceDoc.exists) {
      if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
      return res.status(404).json({ message: 'Service not found.' });
    }

    const currentServiceData = serviceDoc.data();

    // Prepare updated data
    const updatedData = {};
    if (name) updatedData.name = name.trim();
    if (description) updatedData.description = description.trim();

    if (req.file) {
      // New image uploaded, set new url and delete old local image file
      updatedData.imageUrl = `/uploads/${req.file.filename}`;
      deleteLocalFile(currentServiceData.imageUrl);
    }

    await docRef.update(updatedData);

    res.status(200).json({
      message: 'Service updated successfully.',
      service: { id: docId, ...currentServiceData, ...updatedData }
    });

  } catch (error) {
    console.error('Error editing service:', error);
    if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
    res.status(500).json({ message: 'Failed to update service.' });
  }
});

// Route 5: Delete service (Admin only)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const docId = req.params.id;
    const docRef = db.collection('services').doc(docId);
    const serviceDoc = await docRef.get();

    if (!serviceDoc.exists) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    const serviceData = serviceDoc.data();
    
    // Delete service record from database
    await docRef.delete();

    // Delete image file from local folder
    deleteLocalFile(serviceData.imageUrl);

    res.status(200).json({ message: 'Service deleted successfully.' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Failed to delete service.' });
  }
});

const seedDefaultServices = async () => {
  try {
    const snapshot = await db.collection('services').get();
    if (snapshot.empty) {
      console.log('No services found. Seeding default services...');
      const defaultServices = [
        {
          name: 'Deep Cleaning',
          description: 'Complete deep cleaning service for all rooms, including kitchen sanitization, bathroom scrubbing, dusting, vacuuming, and floor mopping.',
          imageUrl: '/uploads/logo.jpg',
          createdAt: new Date().toISOString()
        },
        {
          name: 'Office Cleaning',
          description: 'Keep your workspace clean and professional. Dusting desks, emptying trash, vacuuming carpets, and sanitizing common areas.',
          imageUrl: '/uploads/logo.jpg',
          createdAt: new Date().toISOString()
        },
        {
          name: 'Window Washing',
          description: 'Streak-free window washing for residential and commercial buildings. Includes interior and exterior glass cleaning.',
          imageUrl: '/uploads/logo.jpg',
          createdAt: new Date().toISOString()
        }
      ];

      for (const service of defaultServices) {
        await db.collection('services').add(service);
      }
      console.log('Default services seeded successfully.');
    }
  } catch (error) {
    console.error('Error seeding default services:', error);
  }
};

router.seedDefaultServices = seedDefaultServices;

module.exports = router;

