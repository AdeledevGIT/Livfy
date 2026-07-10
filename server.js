require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin
const serviceAccount = {
  "type": process.env.FIREBASE_TYPE,
  "project_id": process.env.FIREBASE_PROJECT_ID,
  "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
  "private_key": process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  "client_email": process.env.FIREBASE_CLIENT_EMAIL,
  "client_id": process.env.FIREBASE_CLIENT_ID,
  "auth_uri": process.env.FIREBASE_AUTH_URI,
  "token_uri": process.env.FIREBASE_TOKEN_URI,
  "auth_provider_x509_cert_url": process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  "client_x509_cert_url": process.env.FIREBASE_CLIENT_X509_CERT_URL
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase Admin initialization error:', error);
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Static files
app.use(express.static(__dirname));

// Firebase Authentication middleware
const authenticateFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified
    };
    next();
  } catch (error) {
    console.error('Firebase token verification error:', error);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve Firebase config securely
app.get('/api/firebase-config', (req, res) => {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  };
  
  // Check if all required config values are present
  if (!config.apiKey || !config.projectId || !config.appId) {
    console.error('Missing Firebase configuration:', config);
    return res.status(500).json({ error: 'Firebase configuration incomplete' });
  }
  
  console.log('Serving Firebase config for project:', config.projectId);
  res.json(config);
});

// Verify Firebase token
app.get('/api/auth/verify', authenticateFirebaseToken, (req, res) => {
  res.json({ 
    valid: true, 
    user: { 
      uid: req.user.uid, 
      email: req.user.email,
      emailVerified: req.user.emailVerified
    } 
  });
});

// Dashboard API endpoint to get user data
app.get('/api/user/dashboard', authenticateFirebaseToken, async (req, res) => {
  try {
    const { uid } = req.user;
    
    // Get Firestore instance
    const db = admin.firestore();
    
    // Get user document
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      // Create user document with default values if it doesn't exist
      const newUser = {
        tokens: 100, // Give new users 100 free tokens
        totalGenerations: 0,
        dailyGenerations: {},
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection('users').doc(uid).set(newUser);
      
      return res.json({
        tokens: newUser.tokens,
        totalGenerations: newUser.totalGenerations,
        dailyGenerations: newUser.dailyGenerations
      });
    }
    
    // Return existing user data
    const userData = userDoc.data();
    res.json({
      tokens: userData.tokens || 0,
      totalGenerations: userData.totalGenerations || 0,
      dailyGenerations: userData.dailyGenerations || {}
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Endpoint to get user's recent activity
app.get('/api/user/activity', authenticateFirebaseToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 10 } = req.query;
    
    // Get Firestore instance
    const db = admin.firestore();
    
    // Query recent generations for the user
    // Handle case where collection might not exist
    let activities = [];
    try {
      const generationsQuery = await db.collection('generations')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit))
        .get();
      
      generationsQuery.forEach(doc => {
        const data = doc.data();
        activities.push({
          id: doc.id,
          ...data
        });
      });
    } catch (queryError) {
      console.log('No generations collection or query failed, returning empty activity');
      // Return empty activities if collection doesn't exist or query fails
      activities = [];
    }
    
    res.json({ activities });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    // Return empty activities instead of error to prevent UI breakage
    res.json({ activities: [] });
  }
});

// Endpoint for token top-up
app.post('/api/payment/process', authenticateFirebaseToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const { tokens, amount } = req.body;
    
    if (!tokens || !amount) {
      return res.status(400).json({ error: 'Tokens and amount required' });
    }
    
    // Validate amounts
    if (tokens <= 0 || amount <= 0) {
      return res.status(400).json({ error: 'Invalid token amount or price' });
    }
    
    // Get Firestore instance
    const db = admin.firestore();
    
    // In a real implementation, you would process the payment here
    // For this example, we'll just add tokens to the user's account
    
    // Update user's token balance
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      tokens: admin.firestore.FieldValue.increment(tokens),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Record the transaction
    await db.collection('transactions').add({
      userId: uid,
      type: 'token_addition',
      amount: tokens,
      cost: amount,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      message: `${tokens} tokens added successfully`,
      newBalance: (await userRef.get()).data().tokens
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// Protected API endpoint for Decart AI (Face Swap)
app.post('/api/ai/stream', authenticateFirebaseToken, (req, res) => {
  res.json({ 
    apiKey: process.env.DECART_API_KEY,
    message: 'API key provided for authenticated user'
  });
});

// Protected API endpoint for generation
app.post('/api/ai/generate', authenticateFirebaseToken, (req, res) => {
  res.json({ 
    apiKey: process.env.DECART_API_KEY,
    message: 'API key provided for authenticated user'
  });
});

// Protected API endpoint for face swap
app.post('/api/ai/faceswap', authenticateFirebaseToken, (req, res) => {
  res.json({ 
    apiKey: process.env.DECART_API_KEY,
    message: 'API key provided for authenticated user'
  });
});

// Serve existing pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/indes.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'indes.html'));
});

app.get('/generate.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'generate.html'));
});

app.get('/home.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html'));
});

app.get('/voice.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'voice.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});