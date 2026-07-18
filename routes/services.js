const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const admin = require('firebase-admin');
const { db, isMock } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

// Use memory storage so file stays in RAM (works on serverless)
const upload = multer({
  storage: multer.memoryStorage(),
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

// Upload image buffer to Firebase Storage and return the public URL
const uploadToFirebaseStorage = async (fileBuffer, originalName, mimetype) => {
  try {
    const bucket = admin.storage().bucket();
    const uniqueName = `services/${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(originalName)}`;
    const file = bucket.file(uniqueName);

    await file.save(fileBuffer, {
      metadata: { contentType: mimetype },
      public: true,
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${uniqueName}`;
    return publicUrl;
  } catch (error) {
    console.error('Firebase Storage upload error:', error);
    throw new Error('Failed to upload image.');
  }
};

// Delete image from Firebase Storage
const deleteFromFirebaseStorage = async (imageUrl) => {
  if (!imageUrl || !imageUrl.includes('storage.googleapis.com')) return;
  try {
    const bucket = admin.storage().bucket();
    // Extract file path from URL
    const urlParts = imageUrl.split(`${bucket.name}/`);
    if (urlParts.length > 1) {
      const filePath = decodeURIComponent(urlParts[1]);
      await bucket.file(filePath).delete();
    }
  } catch (error) {
    console.error('Failed to delete image from Firebase Storage:', error.message);
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
      return res.status(400).json({ message: 'Name and description are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Service image file is required.' });
    }

    let imageUrl;
    if (isMock) {
      // For local dev without Firebase Storage, use a placeholder
      imageUrl = '/uploads/logo.jpg';
    } else {
      imageUrl = await uploadToFirebaseStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

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
    res.status(500).json({ message: error.message || 'Failed to create service.' });
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
      return res.status(404).json({ message: 'Service not found.' });
    }

    const currentServiceData = serviceDoc.data();

    // Prepare updated data
    const updatedData = {};
    if (name) updatedData.name = name.trim();
    if (description) updatedData.description = description.trim();

    if (req.file) {
      if (isMock) {
        updatedData.imageUrl = '/uploads/logo.jpg';
      } else {
        // Upload new image to Firebase Storage
        updatedData.imageUrl = await uploadToFirebaseStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
        // Delete old image from Firebase Storage
        await deleteFromFirebaseStorage(currentServiceData.imageUrl);
      }
    }

    await docRef.update(updatedData);

    res.status(200).json({
      message: 'Service updated successfully.',
      service: { id: docId, ...currentServiceData, ...updatedData }
    });

  } catch (error) {
    console.error('Error editing service:', error);
    res.status(500).json({ message: error.message || 'Failed to update service.' });
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

    // Delete image from Firebase Storage
    if (!isMock) {
      await deleteFromFirebaseStorage(serviceData.imageUrl);
    }

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
          imageUrl: '',
          createdAt: new Date().toISOString()
        },
        {
          name: 'Office Cleaning',
          description: 'Keep your workspace clean and professional. Dusting desks, emptying trash, vacuuming carpets, and sanitizing common areas.',
          imageUrl: '',
          createdAt: new Date().toISOString()
        },
        {
          name: 'Window Washing',
          description: 'Streak-free window washing for residential and commercial buildings. Includes interior and exterior glass cleaning.',
          imageUrl: '',
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
