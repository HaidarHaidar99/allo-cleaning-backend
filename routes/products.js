const express = require('express');
const router = express.Router();
const path = require('path');
const { db, isMock } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

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
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, category, description, price, imageBase64 } = req.body;

    if (!name || !category || !description) {
      return res.status(400).json({ message: 'Name, category, and description are required.' });
    }

    if (!imageBase64) {
      return res.status(400).json({ message: 'Product image is required.' });
    }

    const productData = {
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      price: price ? parseFloat(price) : null,
      imageBase64: imageBase64,
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
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { name, category, description, price, imageBase64, imageUrl } = req.body;
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
    if (imageBase64) updatedData.imageBase64 = imageBase64;
    // Retain legacy imageUrl if no new base64 image is provided and a legacy url exists.
    if (imageUrl) updatedData.imageUrl = imageUrl;

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

    res.status(200).json({ message: 'Product deleted successfully.' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Failed to delete product.' });
  }
});

module.exports = router;
