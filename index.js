// import Package
require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors')
const port = process.env.PORT
// mongoDB import
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


const stripe = require('stripe')(process.env.STRIPE_SECRET);


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
const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
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
        const db = client.db("BookCourier")
        const usersCollection = db.collection('users');
        const booksCollection = db.collection('books');
        const ordersCollection = db.collection('orders');
        const wishlistCollection = db.collection('wishlist');
        const reviewsCollection = db.collection('reviews');


        // Section: Middle admin before allowing admin activity
        // must be used after verifyFBToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }
        // Section: Middle librarian before allowing librarian activity
        // must be used after verifyFBToken middleware
        const verifyLibrarian = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'librarian') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }


        // Section: User Relative API
        //  api- User create
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.createAt = new Date();
            const email = user.email;
            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                return res.send({ message: "user exists" })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

        // api- single user get
        app.get("/users/:email/role", async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email })
            res.send({ role: user?.role || 'user' })
        })

        // api- user update
        app.patch("/users/:email/update", async (req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const update = {
                $set: {
                    displayName: req.body.displayName,
                    photoURL: req.body.photoURL
                }
            }
            const user = await usersCollection.updateOne(query, update)
            res.send(user)
        })

        // api- Get all users
        app.get('/users', async (req, res) => {
            try {
                const users = await usersCollection.find({}).toArray();
                res.send(users);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch users" });
            }
        });

        // api- Update user role
        app.patch('/users/:email/role', async (req, res) => {
            try {
                const email = req.params.email;
                const { role } = req.body;
                const query = { email: email };
                const update = {
                    $set: { role: role }
                };
                const result = await usersCollection.updateOne(query, update);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to update role" });
            }
        });

        // Section: Book Relative Api
        // api- Create Book
        app.post("/books", async (req, res) => {
            try {
                const books = await booksCollection.insertOne(req.body)
                res.send(books)
            } catch (error) {
                res.status(500).send({ message: "Failed to Book Insert" })
            }
        })

        // api- Latest Book home page
        app.get('/latest-books', async (req, res) => {
            try {
                const result = await booksCollection.find().sort({ createdAt: -1 }).limit(10).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch latest books" });
            }
        });


        // Put the more specific route FIRST
        app.get("/books/:email/myBooks", async (req, res) => {
            try {
                const email = req.params.email;
                const books = await booksCollection.find({ librarianEmail: email }).toArray();
                res.send(books);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch Books" });
            }
        });

        // api- user all books
        app.get('/all-books', async (req, res) => {
            const result = await booksCollection.find().toArray();
            res.send(result);
        });

        // Then the general route
        app.get("/books", async (req, res) => {
            try {
                const { search, category, maxPrice, status } = req.query;
                let query = {};

                if (status) query.status = status;

                if (search) {
                    query.$or = [
                        { title: { $regex: search, $options: "i" } },
                        { author: { $regex: search, $options: "i" } }
                    ];
                }

                if (category) {
                    query.category = category;
                }

                if (maxPrice) {
                    query.price = { $lte: Number(maxPrice) };
                }

                const items = await booksCollection.find(query).toArray();
                res.send(items);
            } catch (error) {
                console.error("Error fetching books:", error); // Add logging
                res.status(500).send({ message: "Failed to fetch filtered data" });
            }
        });

        // api- Get single book by id
        app.get("/books/:id", async (req, res) => {
            const id = req.params.id;
            const result = await booksCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // api- Update book by id
        app.put("/books/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updateBook = { $set: req.body };
            const result = await booksCollection.updateOne(query, updateBook);
            res.send(result);
        });

        // api- // admin Expect { status: 'published' | 'unpublished' }
        app.patch('/books/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { status: status }
            };
            const result = await booksCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // api- Book delete
        app.delete('/books/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await booksCollection.deleteOne(query);
            const deleteOrdersResult = await ordersCollection.deleteMany({ bookId: id });
            res.send({
                deletedCount: result.deletedCount,
                ordersDeletedCount: deleteOrdersResult.deletedCount
            });
        });

        // Section: Order
        // api- Place an order
        app.post("/orders", verifyFBToken, async (req, res) => {
            const orderData = req.body;
            if (orderData.userEmail !== req.decoded_email) {
                return res.status(403).send({ message: "Forbidden: cannot place order for another user" });
            }
            try {
                const result = await ordersCollection.insertOne(orderData);
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to place order" });
            }
        });

        // Get orders by user email (for My Orders page)
        app.get("/orders/:email", verifyFBToken, async (req, res) => {
            const email = req.params.email;
            const result = await ordersCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        // Get orders by user email (for My Orders page)
        app.get("/orders/:email", verifyFBToken, async (req, res) => {
            const email = req.params.email;
            if (req.decoded_email !== email) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const result = await ordersCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        // Cancel Order (or patch status update)
        app.patch("/orders/:id", verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const update = { $set: req.body }
            const result = await ordersCollection.updateOne(query, update);
            res.send(result);
        });

        // Section: Wishlist
        // Add to Wishlist
        app.post("/wishlist", async (req, res) => {
            const wishlistData = req.body;

            // Check if already in wishlist
            const existing = await wishlistCollection.findOne({
                bookId: wishlistData.bookId,
                userEmail: wishlistData.userEmail
            });

            if (existing) {
                return res.send({ message: "Already in wishlist", insertedId: null });
            }
            const result = await wishlistCollection.insertOne(wishlistData);
            res.send(result);
        });
        // Get Wishlist by user
        app.get("/wishlist/:email", async (req, res) => {
            const email = req.params.email;
            const result = await wishlistCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });
        // Remove from Wishlist
        app.delete("/wishlist/:id", async (req, res) => {
            const id = req.params.id;
            const result = await wishlistCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // Add a review
        app.post("/reviews", async (req, res) => {
            const reviewData = req.body;
            // { bookId: "...", userEmail: "...", rating: 5, comment: "..." }
            const result = await reviewsCollection.insertOne(reviewData);
            res.send(result);
        });
        // Get reviews for a book
        app.get("/reviews/:bookId", async (req, res) => {
            const bookId = req.params.bookId;
            const result = await reviewsCollection.find({ bookId: bookId }).toArray();
            res.send(result);
        });

        // Section: MongoDB connection check
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