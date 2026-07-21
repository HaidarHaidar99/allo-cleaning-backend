const express = require('express');
const router = express.Router();
const path = require('path');
const { db, isMock } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

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
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, description, imageBase64 } = req.body;

    if (!name || !description) {
      return res.status(400).json({ message: 'Name and description are required.' });
    }

    if (!imageBase64) {
      return res.status(400).json({ message: 'Service image is required.' });
    }

    const serviceData = {
      name: name.trim(),
      description: description.trim(),
      imageBase64: imageBase64,
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
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { name, description, imageBase64, imageUrl } = req.body;
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
    if (imageBase64) updatedData.imageBase64 = imageBase64;
    // Retain legacy imageUrl if no new base64 image is provided and a legacy url exists.
    if (imageUrl) updatedData.imageUrl = imageUrl;

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

    res.status(200).json({ message: 'Service deleted successfully.' });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ message: 'Failed to delete service.' });
  }
});

module.exports = router;
