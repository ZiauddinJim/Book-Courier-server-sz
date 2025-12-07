// import Package
require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors')
const port = process.env.PORT
// mongoDB import
const { MongoClient, ServerApiVersion } = require('mongodb');


// firebase import 
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);
// const serviceAccount = require("path/to/serviceAccountKey.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// middleware
app.use(cors());
app.use(express.json());

// Section: Firebase verify middleware
const firebaseVerifyToken = async (req, res, next) => {
    // console.log(req.headers.authorization);
    // console.log("i am from firebase middleware.");
    if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorize request!" })
    }
    const token = req.headers.authorization.split(" ")[1]
    // console.log(token);
    if (!token) {
        return res.status(401).send({ message: "Token is not authorize!" })
    }
    // verify id token
    try {
        const tokenInfo = await admin.auth().verifyIdToken(token)
        req.token_email = tokenInfo.email;
        // console.log("after token validation:", tokenInfo);
        next()
    } catch (error) {
        console.log(error);
        return res.status(401).send({ message: "Token is not authorize!" })
    }
}

// connect mongoDB
const uri = process.env.URI
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

//app run
app.get('/', (req, res) => {
    res.send("This is my Book Courier Server.")
})

// app published
app.listen(port, () => {
    console.log(`Book Courier server is running to now port: ${port}`);
})