const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let db;
let isMock = false;

// Check for Firebase credentials in env or a local JSON file
const hasEnvConfig = process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY;
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
const hasFileConfig = fs.existsSync(serviceAccountPath);

if (hasEnvConfig || hasFileConfig) {
  try {
    let credential;
    if (hasFileConfig) {
      const serviceAccount = require(serviceAccountPath);
      credential = admin.credential.cert(serviceAccount);
    } else {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      });
    }
    const projectId = hasFileConfig ? require(serviceAccountPath).project_id : process.env.FIREBASE_PROJECT_ID;

    admin.initializeApp({
      credential: credential,
      storageBucket: `${projectId}.firebasestorage.app`
    });

    db = admin.firestore();
    console.log('Firebase Firestore initialized successfully.');
  } catch (error) {
    console.error('Firebase initialization failed. Falling back to local JSON database.', error);
    setupMockDb();
  }
} else {
  console.log('No Firebase credentials found. Falling back to local JSON database.');
  setupMockDb();
}

function setupMockDb() {
  isMock = true;
  const dataDir = path.join(__dirname, '..', 'data');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  class MockDocRef {
    constructor(collection, id) {
      this.collection = collection;
      this.id = id;
    }

    async get() {
      const data = this.collection.dbData.find(item => item.id === this.id);
      return {
        exists: !!data,
        id: this.id,
        data: () => data ? JSON.parse(JSON.stringify(data)) : null
      };
    }

    async update(newData) {
      const index = this.collection.dbData.findIndex(item => item.id === this.id);
      if (index !== -1) {
        // Exclude id from update keys
        const cleanUpdate = { ...newData };
        delete cleanUpdate.id;
        
        this.collection.dbData[index] = { 
          ...this.collection.dbData[index], 
          ...cleanUpdate 
        };
        await this.collection.save();
      } else {
        throw new Error(`Document with ID ${this.id} not found.`);
      }
    }

    async delete() {
      this.collection.dbData = this.collection.dbData.filter(item => item.id !== this.id);
      await this.collection.save();
    }

    async set(data, options = {}) {
      const index = this.collection.dbData.findIndex(item => item.id === this.id);
      const itemData = { id: this.id, ...data };
      
      if (index !== -1) {
        if (options.merge) {
          const cleanUpdate = { ...data };
          delete cleanUpdate.id;
          this.collection.dbData[index] = { ...this.collection.dbData[index], ...cleanUpdate };
        } else {
          this.collection.dbData[index] = itemData;
        }
      } else {
        this.collection.dbData.push(itemData);
      }
      await this.collection.save();
    }
  }

  class MockCollectionRef {
    constructor(name) {
      this.name = name;
      this.filepath = path.join(dataDir, `${name}.json`);
      this.dbData = [];
      this.load();
    }

    load() {
      try {
        if (fs.existsSync(this.filepath)) {
          this.dbData = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
        } else {
          this.dbData = [];
        }
      } catch (e) {
        this.dbData = [];
      }
    }

    async save() {
      try {
        fs.writeFileSync(this.filepath, JSON.stringify(this.dbData, null, 2));
      } catch (e) {
        console.error(`Failed to save mock collection ${this.name}`, e);
      }
    }

    doc(id) {
      // If no id is provided, generate one
      const targetId = id || Math.random().toString(36).substring(2, 15);
      return new MockDocRef(this, targetId);
    }

    async add(data) {
      const id = Math.random().toString(36).substring(2, 15);
      const docData = { id, ...data };
      this.dbData.push(docData);
      await this.save();
      return { id, get: () => this.doc(id).get() };
    }

    async get() {
      this.load(); // Refresh data
      const docs = this.dbData.map(item => ({
        id: item.id,
        exists: true,
        data: () => JSON.parse(JSON.stringify(item))
      }));
      return {
        docs,
        forEach: (cb) => docs.forEach(cb),
        empty: docs.length === 0,
        size: docs.length
      };
    }

    where(field, op, value) {
      this.load(); // Refresh data
      const filtered = this.dbData.filter(item => {
        if (op === '==') return item[field] === value;
        if (op === '>=') return item[field] >= value;
        if (op === '<=') return item[field] <= value;
        if (op === '>') return item[field] > value;
        if (op === '<') return item[field] < value;
        return true;
      });
      const docs = filtered.map(item => ({
        id: item.id,
        exists: true,
        data: () => JSON.parse(JSON.stringify(item))
      }));
      
      return {
        get: async () => ({
          docs,
          forEach: (cb) => docs.forEach(cb),
          empty: docs.length === 0,
          size: docs.length
        })
      };
    }
  }

  const collections = {};
  db = {
    collection: (name) => {
      if (!collections[name]) {
        collections[name] = new MockCollectionRef(name);
      }
      return collections[name];
    }
  };
}

module.exports = { db, isMock };
