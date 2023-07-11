
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: "http://www.example.com/auth/google/callback"
},
function(accessToken, refreshToken, profile, cb) {
  // Here you would typically look up the user in your database using the profile info
  // And perform your admin check
  // For this dummy example, let's say every Google user is an admin
  return cb(null, profile);
}
));

// Here's a route that triggers the Google authentication
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile'] }));

// And here's the callback route Google will redirect the user to after they have signed in
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });


const express = require('express');
const app = express();
const port = 3000;

let dummyServiceStatus = 'stopped';

// Middleware for checking if the user is admin
function isAdmin(req, res, next) {
  // TODO: Implement your authentication logic here.
  // This is just a placeholder
  if (req.get('Authorization') === 'Bearer admin') {
    next();
  } else {
    res.status(403).send('You are not authorized to perform this action');
  }
}

// Status endpoint
app.get('/status', isAdmin, (req, res) => {
  res.send(`Dummy service is currently: ${dummyServiceStatus}`);
});

// Start endpoint
app.post('/start', isAdmin, (req, res) => {
  // TODO: Implement your service start logic here
  dummyServiceStatus = 'running';
  res.send('Dummy service started');
});

// Stop endpoint
app.post('/stop', isAdmin, (req, res) => {
  // TODO: Implement your service stop logic here
  dummyServiceStatus = 'stopped';
  res.send('Dummy service stopped');
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
});

