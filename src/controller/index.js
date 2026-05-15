const express = require('express');
const app = express();
const PORT = 3000;

/*
GETS -> RETRIEVE PREVIOUS DATA, RETRIEVE USER DATA, AI ANALYSIS, AI SHEETS, DOLLAR/BITCOIN ANALYSIS

POSTS -> IMPORT PDF FILE, SINGUP, LOGIN,  SEND AI DATA

PATCH -> UPDATE USER DATA

DELETE -> DELETE USER DATA (ALL), DELETE USER BANKING DATA

*/


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})

//GET

app.get('/', (req, res) => {
    res.send('Hello World!');
})

app.get('retrieve-data', (req, res) => {
    // Code to retrieve previous data
    res.send('Data retrieved successfully!');
})

app.get('retrieve-user-data', (req, res) => {
    // Code to retrieve user data
    res.send('User data retrieved successfully!');
})

app.get('ai-analysis', (req, res) => {
    // Code to perform AI analysis
    res.send('Success!');
})

app.get('ai-sheets', (req, res) => {
    // Code to perform AI analysis
    res.send('Success!');
})
app.get('dollarbit-cotation', (req, res) => {
    // Code to perform AI analysis
    res.send('Success!');
})


//POSTS
app.post('import-pdf', (req, res) => {
    // Code to import PDF file
    res.send('PDF file imported successfully!');
}
)
app.post('signup', (req, res) => {
    // Code to handle user signup
    res.send('User signed up successfully!');
})

app.post('login', (req, res) => {
    // Code to handle user login
    res.send('User logged in successfully!');
})

app.post('send-ai-data', (req, res) => {
    // Code to send AI data
    res.send('AI data sent successfully!');
})

//PATCH
app.patch('update-user-data', (req, res) => {
// Code to update user data
res.send('User data updated successfully!');
})


//DELETE

app.delete('delete-user-data', (req, res) => {
    // Code to delete user data
    res.send('User data deleted successfully!');
})
app.delete('delete-user-banking-data', (req, res) => {
    // Code to delete user banking data
    res.send('User banking data deleted successfully!');
})