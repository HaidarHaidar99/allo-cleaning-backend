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

// Route 1: Get all products (Public)
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('products').get();
    const products = [];
    snapshot.forEach(doc => {
      products.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Failed to fetch products.' });
  }
});

// Route 2: Get single product (Public)
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('products').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Product not found.' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ message: 'Failed to fetch product.' });
  }
});

// Route 3: Add new product (Admin only)
router.post('/', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { name, category, description, price } = req.body;

    if (!name || !category || !description) {
      if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
      return res.status(400).json({ message: 'Name, category, and description are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Product image file is required.' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    const productData = {
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      price: price ? parseFloat(price) : null,
      imageUrl,
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('products').add(productData);
    
    res.status(201).json({
      message: 'Product created successfully.',
      product: { id: docRef.id, ...productData }
    });

  } catch (error) {
    console.error('Error adding product:', error);
    if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
    res.status(500).json({ message: 'Failed to create product.' });
  }
});

// Route 4: Edit product (Admin only)
router.put('/:id', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { name, category, description, price } = req.body;
    const docId = req.params.id;

    // Check if product exists
    const docRef = db.collection('products').doc(docId);
    const productDoc = await docRef.get();
    if (!productDoc.exists) {
      if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
      return res.status(404).json({ message: 'Product not found.' });
    }

    const currentProductData = productDoc.data();

    // Prepare updated data
    const updatedData = {};
    if (name) updatedData.name = name.trim();
    if (category) updatedData.category = category.trim();
    if (description) updatedData.description = description.trim();
    if (price !== undefined) {
      updatedData.price = price ? parseFloat(price) : null;
    }

    if (req.file) {
      updatedData.imageUrl = `/uploads/${req.file.filename}`;
      deleteLocalFile(currentProductData.imageUrl);
    }

    await docRef.update(updatedData);

    res.status(200).json({
      message: 'Product updated successfully.',
      product: { id: docId, ...currentProductData, ...updatedData }
    });

  } catch (error) {
    console.error('Error editing product:', error);
    if (req.file) deleteLocalFile(`/uploads/${req.file.filename}`);
    res.status(500).json({ message: 'Failed to update product.' });
  }
});

// Route 5: Delete product (Admin only)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const docId = req.params.id;
    const docRef = db.collection('products').doc(docId);
    const productDoc = await docRef.get();

    if (!productDoc.exists) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const productData = productDoc.data();
    await docRef.delete();
    deleteLocalFile(productData.imageUrl);

    res.status(200).json({ message: 'Product deleted successfully.' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Failed to delete product.' });
  }
});

const seedDefaultProducts = async () => {
  try {
    const snapshot = await db.collection('products').get();
    if (snapshot.empty) {
      console.log('No products found. Seeding default products...');
      const defaultProducts = [
        {
          name: 'Premium Microfiber Cloths (4-Pack)',
          category: 'Cleaning Supplies',
          description: 'Ultra-soft, highly absorbent microfiber cloths suitable for lint-free surface polishing and dusting.',
          price: 12.99,
          imageUrl: '/uploads/logo.jpg',
          createdAt: new Date().toISOString()
        },
        {
          name: 'All-Purpose Organic Spray',
          category: 'Cleaning Sprays',
          description: 'Environmentally safe, biodegradable all-purpose cleaner with organic lemon essence extract.',
          price: 9.50,
          imageUrl: '/uploads/logo.jpg',
          createdAt: new Date().toISOString()
        },
        {
          name: 'Sanitizing Disinfectant Wipes',
          category: 'Cleaning Supplies',
          description: 'Eliminates 99.9% of bacteria and germs. Suitable for office desks and household surface sanitization.',
          price: null, // Test case for optional price
          imageUrl: '/uploads/logo.jpg',
          createdAt: new Date().toISOString()
        }
      ];

      for (const product of defaultProducts) {
        await db.collection('products').add(product);
      }
      console.log('Default products seeded successfully.');
    }
  } catch (error) {
    console.error('Error seeding default products:', error);
  }
};

router.seedDefaultProducts = seedDefaultProducts;

module.exports = router;
