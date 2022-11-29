require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


// middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.gof4ucb.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


// jwt token function for verification from client side
function verifyJwt(req, res, next) {
    // console.log('token inside verifyJWT', req.headers.authorization);
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next()
    })
}

async function run() {
    try {
        const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOption')
        const bookingsCollection = client.db('doctorsPortal').collection('bookings')
        const usersCollection = client.db('doctorsPortal').collection('users')
        const doctorsCollection = client.db('doctorsPortal').collection('doctors')
        const paymentsCollection = client.db('doctorsPortal').collection('payments')

        // note: run the verifyAdmin after verifyJwt
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }

        app.get('/slots', async (req, res) => {
            const date = req.query.date;
            // console.log(date)
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray()
            // code for slot booking date and remaining time 
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray()
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatmentName === option.name);
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots
                // console.log(date, option.name, remainingSlots.length)
            })
            res.send(options)
        })
        /*
        naming conventions
        app.get(./slots')
        app.get('/slots/:id')
        app.post('/booking')
        app.patch('/booking/:id') for update individual data
        app.delete('/booking/:id')
         */
        app.get('/booking', verifyJwt, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.query.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'unauthorized access' });
            }

            const query = { email: email };
            const booking = await bookingsCollection.find(query).toArray()
            res.send(booking);
        })

        // for payment
        app.get('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query)
            res.send(booking)
        })

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatmentName: booking.treatmentName
            }

            const bookedAlready = await bookingsCollection.find(query).toArray();

            if (bookedAlready.length) {
                const message = `You already have a booking on ${booking.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingsCollection.insertOne(booking)
            res.send(result)
        })

      

        // to check whether user is admin or not
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })

        // create API for admin panel
        app.put('/users/admin/:id', verifyJwt, verifyAdmin, async (req, res) => {


            // these codes used in verifyAdmin and call it from here
            // const decodedEmail = req.decoded.email;
            // const query = {email: decodedEmail};
            // const user = await usersCollection.findOne(query);

            // if(user?.role !== 'admin'){
            //     return res.status(403).send({message: 'forbidden access'})
            // }


            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })

        // Payment section connected with client side
        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;

            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            })
        })

// payment details show
        app.post('/payments', async (req, res) =>{
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment)
            const id = payment.bookingId
            const filter = { _id: ObjectId(id)}
            const updateDoc = {
                $set:{
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            
            const updatedresult = await bookingsCollection.updateOne(filter, updateDoc)
            res.send(result)
        })


        // jwt token creation
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: '' })
        })

          // get all users
          app.get('/users', async (req, res) => {
            const query = {}
            const result = await usersCollection.find(query).toArray()
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user)
            res.send(result);
        })

        // find specific object from data with project
        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray()
            res.send(result)
        })

        // doctors info posted to db
        app.post('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        })

        // get posted doctors info
        app.get('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors)
        })
        // deleting Doctor
        app.delete('/doctors/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })



        //temporary price update with appointmentOptions. use the api from chrome url it will automatically update.
        app.get('/addPrice', async (req, res) => {
            const filter = {}
            const option = { upsert: true }
            const updatePrice = {
                $set: {
                    price: 99
                }
            }
            const result = await appointmentOptionCollection.updateMany(filter, updatePrice, option)
            res.send(result)
        })

    }
    finally {

    }
}
run().catch(err => console.dir(err))



app.get('/', async (req, res) => {
    res.send('This is Doctor server')
})

app.listen(port, () => {
    console.log(`Doctors site running on ${port}`)
})

