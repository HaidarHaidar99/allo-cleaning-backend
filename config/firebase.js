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
      credential: credential
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

  class MockQuery {
    constructor(collectionRef, docs) {
      this.collectionRef = collectionRef;
      this._docs = docs;
    }

    where(field, op, value) {
      const filtered = this._docs.filter(doc => {
        const item = doc.data();
        if (op === '==') return item[field] === value;
        if (op === '>=') return item[field] >= value;
        if (op === '<=') return item[field] <= value;
        if (op === '>') return item[field] > value;
        if (op === '<') return item[field] < value;
        return true;
      });
      return new MockQuery(this.collectionRef, filtered);
    }

    orderBy(field, direction = 'asc') {
      const sorted = [...this._docs].sort((a, b) => {
        const valA = a.data()[field];
        const valB = b.data()[field];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        
        const comparison = valA < valB ? -1 : 1;
        return direction === 'desc' ? -comparison : comparison;
      });
      return new MockQuery(this.collectionRef, sorted);
    }

    limit(n) {
      return new MockQuery(this.collectionRef, this._docs.slice(0, n));
    }

    count() {
      return {
        get: async () => ({
          data: () => ({ count: this._docs.length })
        })
      };
    }

    async get() {
      return {
        docs: this._docs,
        forEach: (cb) => this._docs.forEach(cb),
        empty: this._docs.length === 0,
        size: this._docs.length
      };
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

    getDocsData() {
      this.load();
      return this.dbData.map(item => ({
        id: item.id,
        exists: true,
        data: () => JSON.parse(JSON.stringify(item))
      }));
    }

    async get() {
      const docs = this.getDocsData();
      return new MockQuery(this, docs).get();
    }

    where(field, op, value) {
      const docs = this.getDocsData();
      return new MockQuery(this, docs).where(field, op, value);
    }

    orderBy(field, direction) {
      const docs = this.getDocsData();
      return new MockQuery(this, docs).orderBy(field, direction);
    }

    limit(n) {
      const docs = this.getDocsData();
      return new MockQuery(this, docs).limit(n);
    }

    count() {
      const docs = this.getDocsData();
      return new MockQuery(this, docs).count();
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
