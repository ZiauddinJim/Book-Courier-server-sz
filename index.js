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
        // console.log('decoded in the token', decoded);
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

function generateTrackingId() {
    return "TRK-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

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
        const paymentsCollection = db.collection('payments');

        await paymentsCollection.createIndex({ transactionId: 1 }, { unique: true })



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
            const result = await ordersCollection.find({ userEmail: email }).sort({ orderDate: -1 }).toArray();
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

        // Section: this role use librarian & librarian orders page
        // api- Get orders for a specific Librarian
        app.get('/librarian-orders/:email', verifyFBToken, async (req, res) => {
            const email = req.params.email;
            if (!email) {
                return res.status(400).json({ error: "Email parameter is required." });
            }
            const result = await ordersCollection.find({ librarianEmail: email }).sort({ orderDate: -1 }).toArray();
            res.send(result);
        })

        // api- this api use librarian orders dashboard
        app.patch('/handleCancelOrder/:id', verifyFBToken, verifyLibrarian, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const update = { $set: req.body }
            const result = await ordersCollection.updateOne(query, update)
            res.send(result)
        })

        app.patch('/handleStatusChange/:id', verifyFBToken, verifyLibrarian, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const update = { $set: req.body }
            const result = await ordersCollection.updateOne(query, update)
            res.send(result)
        })

        // Section: Payment relative API
        // api- my order page to go stripe payment API
        app.post("/payment-checkout-session", async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.price) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: "BDT",
                            unit_amount: amount,
                            product_data: {
                                name: `Please pay for: ${paymentInfo.bookTitle}`,
                            }
                        },
                        quantity: 1,
                    },
                ],
                // customer: paymentInfo.senderName,
                customer_email: paymentInfo.userEmail,
                metadata: {
                    orderId: paymentInfo._id,
                    bookTitle: paymentInfo.bookTitle,
                },
                mode: 'payment',
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?success=true&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            })
            // console.log(session);
            res.send({ url: session.url });
        })

        // api- payment success api
        app.patch("/payment-success", async (req, res) => {
            try {
                const sessionId = req.query.session_id;
                const session = await stripe.checkout.sessions.retrieve(sessionId);

                const transactionId = session.payment_intent;
                const orderId = session.metadata.orderId;

                // STEP 1: Check duplicate FIRST
                const existingPayment = await paymentsCollection.findOne({ transactionId });

                if (existingPayment) {
                    return res.send({
                        success: true,
                        message: "Payment already exists",
                        transactionId,
                        trackingId: existingPayment.trackingId
                    });
                }

                // STEP 2: Ensure payment was successful
                if (session.payment_status !== "paid") {
                    return res.send({ success: false, message: "Payment not completed" });
                }

                const trackingId = generateTrackingId();

                // STEP 3: Update order
                await ordersCollection.updateOne(
                    { _id: new ObjectId(orderId) },
                    {
                        $set: {
                            paymentStatus: "paid",
                            status: "pending",
                            transactionId,
                            trackingId
                        }
                    }
                );

                // STEP 4: Save payment → catch duplicates by index
                const paymentData = {
                    sessionId,
                    transactionId,
                    orderId,
                    bookTitle: session.metadata.bookTitle,
                    customerEmail: session.customer_email,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    paymentStatus: session.payment_status,
                    trackingId,
                    paidAt: new Date()
                };

                try {
                    await paymentsCollection.insertOne(paymentData);
                } catch (err) {

                    if (err.code === 11000) {
                        const existing = await paymentsCollection.findOne({ transactionId });
                        return res.send({
                            success: true,
                            message: "Payment already exists",
                            transactionId,
                            trackingId: existing.trackingId
                        });
                    }
                    throw err;
                }

                res.send({
                    success: true,
                    message: "Payment recorded successfully",
                    transactionId,
                    trackingId
                });

            } catch (error) {
                console.error("Payment error:", error);
                res.status(500).send({ success: false, message: "Payment processing failed" });
            }
        });

        app.get("/payment/:email", verifyFBToken, async (req, res) => {
            const email = req.params.email;
            if (req.decoded_email !== email) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const result = await paymentsCollection.find({ customerEmail: email }).toArray();
            res.send(result)
        })

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

        // Section: Dashboard Stats
        // Admin Stats
        app.get('/admin-stats', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const totalUsers = await usersCollection.estimatedDocumentCount();
                const totalBooks = await booksCollection.estimatedDocumentCount();
                const totalOrders = await ordersCollection.estimatedDocumentCount();
                // Revenue calculation (sum filter payments for paid orders)
                // Assuming payment-success creates records in paymentsCollection with amount
                const payments = await paymentsCollection.find({}).toArray();
                const revenue = payments.reduce((acc, curr) => acc + curr.amount, 0);

                res.send({ totalUsers, totalBooks, totalOrders, revenue });
            } catch (error) {
                console.error("Admin stats error:", error);
                res.status(500).send({ message: "Failed to fetch admin stats" });
            }
        });

        // Librarian Stats
        app.get('/librarian-stats/:email', verifyFBToken, verifyLibrarian, async (req, res) => {
            try {
                const email = req.params.email;
                if (req.decoded_email !== email) {
                    return res.status(403).send({ message: "Forbidden Access" });
                }
                const myBooksCount = await booksCollection.countDocuments({ librarianEmail: email });
                // Assuming librarian-orders logic checks for books ordered that belong to this librarian
                // This might be complex if orders don't store librarianEmail directly. 
                // Based on previous code: app.get('/librarian-orders/:email' ... finds { librarianEmail: email }
                // So orders DO have librarianEmail.
                const myOrdersCount = await ordersCollection.countDocuments({ librarianEmail: email });
                res.send({ myBooksCount, myOrdersCount });
            } catch (error) {
                console.error("Librarian stats error:", error);
                res.status(500).send({ message: "Failed to fetch librarian stats" });
            }
        });

        // User Stats
        app.get('/user-stats/:email', verifyFBToken, async (req, res) => {
            try {
                const email = req.params.email;
                if (req.decoded_email !== email) {
                    return res.status(403).send({ message: "Forbidden Access" });
                }

                const myOrdersCount = await ordersCollection.countDocuments({ userEmail: email });
                const myWishlistCount = await wishlistCollection.countDocuments({ userEmail: email });
                res.send({ myOrdersCount, myWishlistCount });
            } catch (error) {
                console.error("User stats error:", error);
                res.status(500).send({ message: "Failed to fetch user stats" });
            }
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