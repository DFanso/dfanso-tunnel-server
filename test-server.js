const express = require('express');
const app = express();
const port = 8000;

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    next();
});

// GET endpoint
app.get('/', (req, res) => {
    res.send('Hello from test server!');
});

// POST endpoint
app.post('/api/data', (req, res) => {
    console.log('Received POST data:', req.body);
    res.json({
        message: 'Data received successfully',
        data: req.body
    });
});

// PUT endpoint
app.put('/api/update/:id', (req, res) => {
    const id = req.params.id;
    console.log(`Updating item ${id}:`, req.body);
    res.json({
        message: `Item ${id} updated successfully`,
        data: req.body
    });
});

// DELETE endpoint
app.delete('/api/delete/:id', (req, res) => {
    const id = req.params.id;
    console.log(`Deleting item ${id}`);
    res.json({
        message: `Item ${id} deleted successfully`
    });
});

// PATCH endpoint
app.patch('/api/patch/:id', (req, res) => {
    const id = req.params.id;
    console.log(`Patching item ${id}:`, req.body);
    res.json({
        message: `Item ${id} patched successfully`,
        data: req.body
    });
});

// OPTIONS endpoint
app.options('/api/*', (req, res) => {
    res.header('Allow', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Test server listening at http://localhost:${port}`);
});
