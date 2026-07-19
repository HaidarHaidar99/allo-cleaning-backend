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
    const uniqueName = `products/${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(originalName)}`;
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
    const urlParts = imageUrl.split(`${bucket.name}/`);
    if (urlParts.length > 1) {
      const filePath = decodeURIComponent(urlParts[1]);
      await bucket.file(filePath).delete();
    }
  } catch (error) {
    console.error('Failed to delete image from Firebase Storage:', error.message);
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
      return res.status(400).json({ message: 'Name, category, and description are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Product image file is required.' });
    }

    let imageUrl;
    if (isMock) {
      imageUrl = '/uploads/logo.jpg';
    } else {
      imageUrl = await uploadToFirebaseStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

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
    res.status(500).json({ message: error.message || 'Failed to create product.' });
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
      if (isMock) {
        updatedData.imageUrl = '/uploads/logo.jpg';
      } else {
        updatedData.imageUrl = await uploadToFirebaseStorage(req.file.buffer, req.file.originalname, req.file.mimetype);
        await deleteFromFirebaseStorage(currentProductData.imageUrl);
      }
    }

    await docRef.update(updatedData);

    res.status(200).json({
      message: 'Product updated successfully.',
      product: { id: docId, ...currentProductData, ...updatedData }
    });

  } catch (error) {
    console.error('Error editing product:', error);
    res.status(500).json({ message: error.message || 'Failed to update product.' });
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

    if (!isMock) {
      await deleteFromFirebaseStorage(productData.imageUrl);
    }

    res.status(200).json({ message: 'Product deleted successfully.' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Failed to delete product.' });
  }
});

const seedDefaultProducts = async () => {
  try {
    const snapshot = await db.collection('products').limit(1).get();
    if (snapshot.empty) {
      console.log('No products found. Seeding default products...');
      const defaultProducts = [
        {
          name: 'Premium Microfiber Cloths (4-Pack)',
          category: 'Cleaning Supplies',
          description: 'Ultra-soft, highly absorbent microfiber cloths suitable for lint-free surface polishing and dusting.',
          price: 12.99,
          imageUrl: '',
          createdAt: new Date().toISOString()
        },
        {
          name: 'All-Purpose Organic Spray',
          category: 'Cleaning Sprays',
          description: 'Environmentally safe, biodegradable all-purpose cleaner with organic lemon essence extract.',
          price: 9.50,
          imageUrl: '',
          createdAt: new Date().toISOString()
        },
        {
          name: 'Sanitizing Disinfectant Wipes',
          category: 'Cleaning Supplies',
          description: 'Eliminates 99.9% of bacteria and germs. Suitable for office desks and household surface sanitization.',
          price: null,
          imageUrl: '',
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
