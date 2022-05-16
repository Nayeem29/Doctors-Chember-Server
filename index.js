const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const res = require('express/lib/response');
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
require('dotenv').config();

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'Forbidden' });
    }
    req.decoded = decoded;
    next();
  });
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.p7gut.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
async function run() {
  try {
    await client.connect();
    console.log('database is connected');
    const serviceCollection = client.db('Doctor_Services').collection('Service_Slot');
    const bookingCollection = client.db('Doctor_Services').collection('bookings');
    const userCollection = client.db('Doctor_Services').collection('users');

    app.get('/services', async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get('/booking', verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (decodedEmail === patient) {
        const query = { patientEmail: patient };
        const cursor = bookingCollection.find(query);
        const result = await cursor.toArray();
        return res.send(result);
      } else {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
    });

    app.put('/user/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: user
      };
      const result = await userCollection.updateOne(filter, updatedDoc, options);
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ result, accessToken: token });
    })
    app.get('/available', async (req, res) => {
      const date = req.query.date;
      // console.log(date);
      const services = await serviceCollection.find().toArray();
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      services.forEach(service => {
        const serviceBooking = bookings.filter(book => book.treatment === service.name);
        const booked = serviceBooking.map(s => s.slot);
        const available = service.slots.filter(s => !booked.includes(s));
        service.slots = available;

      });

      res.send(services)
    })
    app.post('/booking', async (req, res) => {

      const doc = req.body;
      // console.log(doc);
      const query = { treatment: doc.treatment, date: doc.date, patientEmail: doc.patientEmail }
      const exist = await bookingCollection.findOne(query);
      // console.log(exist);
      if (exist) {
        return res.send({ success: false, doc: exist })
      }
      const result = await bookingCollection.insertOne(doc);
      return res.send({ success: true, result });
    })

  } finally {

  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Doctors Chember is running !!');
})

app.listen(port, () => {
  console.log('Server is okay now!!');
})