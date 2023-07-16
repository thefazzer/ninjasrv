const fs = require('fs');
const path = require('path'); 
const exec = require('child_process').exec;

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
const port = 3000;

// Use more descriptive constant name  
const GOOGLE_DRIVE_FOLDER_ID = '1VgStbKc5zL0DFJ7BRZYGf7nlu7-OOThM';

app.use(session({ 
  secret: 'your-secret',
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

// Get CLIENT_ID from passport config
const passportConfig = {
  clientID: '740807273849-h1btj8ui5fkdvq14a9ulnl601ukbq6p0.apps.googleusercontent.com',
  clientSecret: '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',
  callbackURL: 'http://localhost:3000/callback'
};

passport.use(new GoogleStrategy(passportConfig, 
  (accessToken, refreshToken, profile, done) => {

  //...

}));

app.get('/auth/google', 
  passport.authenticate('google', {
    scope: ['profile', 'https://www.googleapis.com/auth/drive']
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google'),
  async (req, res) => {

    try {
      const code = req.query.code;
      
      // Get CLIENT_ID from passport config
      const client = new OAuth2Client(passportConfig.clientID);
      
      const tokens = await client.getToken(code);

      req.user.accessToken = tokens.access_token;
      req.user.refreshToken = tokens.refresh_token;

      res.redirect('/');

    } catch (err) {
      console.error(err);
      return res.status(500);
    }

});

// ...other routes 

const { isAuthenticated } = require('passport');

/* app.get('/list-files', isAuthenticated, async (req, res, next) => {

  try {

    const accessToken = req.user.accessToken;

    const drive = google.drive({
      version: 'v3',
      auth: accessToken
    });
    
    const response = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    res.send(response.data.files);

  } catch (err) {
    res.status(500).send(err);
  }

}); */

app.listen(port, () => {
  console.log(`App listening on port ${port}`); 
});