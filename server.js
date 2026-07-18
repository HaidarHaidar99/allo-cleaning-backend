const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const { db } = require('./config/firebase');
const { verifyToken } = require('./middleware/auth');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: '*', // For local development simplicity. In production, specify frontend domain
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create uploads directory if it does not exist (for local dev static files only)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded images statically (legacy/local dev fallback)
app.use('/uploads', express.static(uploadsDir));

// Import routers
const authRouter = require('./routes/auth');
const servicesRouter = require('./routes/services');
const productsRouter = require('./routes/products');
const formsRouter = require('./routes/forms');
const adminsRouter = require('./routes/admins');
const settingsRouter = require('./routes/settings');


// Seed default admin account and services
if (authRouter.seedDefaultAdmin) {
  authRouter.seedDefaultAdmin();
}
if (servicesRouter.seedDefaultServices) {
  servicesRouter.seedDefaultServices();
}
if (productsRouter.seedDefaultProducts) {
  productsRouter.seedDefaultProducts();
}


// Mount routers
app.use('/api/auth', authRouter);
app.use('/api/services', servicesRouter);
app.use('/api/products', productsRouter);
app.use('/api/forms', formsRouter);
app.use('/api/admins', adminsRouter);
app.use('/api/settings', settingsRouter);


// Admin Dashboard stats endpoint
app.get('/api/stats', verifyToken, async (req, res) => {
  try {
    const servicesSnapshot = await db.collection('services').get();
    const formsSnapshot = await db.collection('forms').get();
    const adminsSnapshot = await db.collection('admins').get();
    const productsSnapshot = await db.collection('products').get();

    res.status(200).json({
      totalServices: servicesSnapshot.size || 0,
      totalForms: formsSnapshot.size || 0,
      totalAdmins: adminsSnapshot.size || 0,
      totalProducts: productsSnapshot.size || 0
    });
  } catch (error) {
    console.error('Error fetching admin dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard stats.' });
  }
});

// Root check endpoint
app.get('/', (req, res) => {
  res.send('Allo Cleaning REST API is running.');
});

// Global error handler to ensure JSON responses
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Upload error: ${err.message}` });
  }
  res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Allo Cleaning Backend Server started on port ${PORT}`);
  });
}

module.exports = app;