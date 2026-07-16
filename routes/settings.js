const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

const defaultSettings = {
  // Contact details & socials
  whatsapp: '15550192834',
  email: 'info@allocleaning.com',
  phone: '+1 (555) 019-2834',
  address: '123 Sparkle Way, Clean City',
  instagram: 'https://instagram.com/allocleaning',
  facebook: 'https://facebook.com/allocleaning',
  
  // Home Page hero
  heroTag: 'Sparkling Clean, Guaranteed',
  heroTitle: 'Professional Cleaning Services for Home & Office',
  heroDescription: 'Experience the joy of a spotless environment. We deliver top-tier, reliable, and eco-friendly cleaning services tailored to your exact needs.',
  
  // Home Page stats
  stat1Number: '5,000+',
  stat1Label: 'Happy Customers',
  stat2Number: '12,000+',
  stat2Label: 'Completed Jobs',
  stat3Number: '150+',
  stat3Label: 'Vetted Cleaners',
  stat4Number: '100%',
  stat4Label: 'Satisfaction Rate',
  
  // Contact Page texts
  contactTitle: 'Contact Our Support Team',
  contactDescription: 'Have questions about our packages or need a custom cleanup quote? Leave us a message below, and our team will reach out shortly!'
};

// GET /api/settings - Public
router.get('/', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('global').get();
    if (!doc.exists) {
      return res.status(200).json(defaultSettings);
    }
    // Return merged defaults and stored settings
    return res.status(200).json({ ...defaultSettings, ...doc.data() });
  } catch (error) {
    console.error('Error fetching settings:', error);
    // Graceful fallback to default values on database errors
    return res.status(200).json(defaultSettings);
  }
});

// PUT /api/settings - Protected (Admin only)
router.put('/', verifyToken, async (req, res) => {
  try {
    const newSettings = req.body;
    // Overwrite/update settings document
    await db.collection('settings').doc('global').set(newSettings, { merge: true });
    
    // Retrieve merged updated settings to return to frontend
    const updatedDoc = await db.collection('settings').doc('global').get();
    return res.status(200).json({ 
      message: 'Settings updated successfully.', 
      settings: { ...defaultSettings, ...updatedDoc.data() } 
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return res.status(500).json({ message: 'Failed to update settings.' });
  }
});

module.exports = router;
