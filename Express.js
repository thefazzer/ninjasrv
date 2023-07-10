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

