require('dotenv').config();
const fs = require('fs');
const path = require('path');
const exec = require('child_process').exec;
const { OAuth2Client } = require('googleapis').Auth;

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
const port = 3000;

const GOOGLE_DRIVE_FOLDER_ID = '18DAq4TnVPNDKgl7a_rLN-XQfaEKrbwXJ';
const TRANSCRIPT_FOLDER_NAME = 'transcript5'

app.use(session({ 
  secret: process.env.SESSION_SECRET,
  resave: false, 
  saveUninitialized: true 
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

const passportConfig = {
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://localhost:3000/callback'
};

passport.use(new GoogleStrategy(passportConfig,
  (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;
    done(null, profile);
  })
);

app.get('/auth/google', 
  passport.authenticate('google', {
    scope: ['profile', 'https://www.googleapis.com/auth/drive']
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google'),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID, 
    process.env.GOOGLE_CLIENT_SECRET, 
    'http://localhost:3000/callback'
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const userinfoResponse = await oauth2Client.request({
      url: 'https://www.googleapis.com/oauth2/v1/userinfo'
    });

    const user = {
      id: userinfoResponse.data.id,
      email: userinfoResponse.data.email,
      name: userinfoResponse.data.name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };

    req.login(user, (err) => {
      if (err) {
        console.error('Error logging in', err);
        res.status(500).send('Error logging in');
        return;
      }

      res.redirect('/');
    });
  
  } catch (err) {
    console.error('Error retrieving access token', err);
    res.status(500).send('Error retrieving access token');
  }
});

async function createGoogleDriveDirectory(drive, parentFolderId, folderName) {
  // check if folder exists
  let response = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and name='${folderName}' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive'
  });
  
  // if not exists, create one
  if (response.data.files.length == 0) {
    var fileMetadata = {
      'name': folderName,
      'mimeType': 'application/vnd.google-apps.folder',
      'parents': [parentFolderId]
    };
    response = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });
    console.log('Folder ID: ', response.data.id);
  } else {
    console.log('Folder already exists');
  }
}

app.get('/list-files', ensureAuthenticated, async (req, res, next) => {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({access_token: req.user.accessToken});

    const drive = google.drive({
      version: 'v3',
      auth: oauth2Client
    });
    
    const response = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    await createGoogleDriveDirectory(drive, GOOGLE_DRIVE_FOLDER_ID, TRANSCRIPT_FOLDER_NAME); // Call the function here

    res.send(JSON.stringify(response.data.files, null, 2)); // Pretty print

  } catch (err) {
    res.status(500).send(err);
  }
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { 
    return next(); 
  }
  res.redirect('/auth/google');
}

app.listen(port, () => {
  console.log(`App listening on port ${port}`); 
});
