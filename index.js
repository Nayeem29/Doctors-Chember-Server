const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const res = require('express/lib/response');
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
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

const senderOptions = {
  auth: {
    api_key: process.env.SEND_APPOINTMENT_EMAIL_KEY
  }
}

const emailClient = nodemailer.createTransport(sgTransport(senderOptions));
function sendAppointmentEmail(doc) {
  const { patientEmail, date, patient, slot } = doc;
  var email = {
    from: process.env.EMAIL_SENDER,
    to: patientEmail,
    subject: `Your appointemnt is dated on ${date} at ${slot}`,
    text: `Your appointemnt is dated on ${date} at ${slot}`,
    html: `
    <div>
    <p>Hello ${patient},</p>
    <p>Your appointment data is: ${date}</p>
    <p>Timing: ${slot}</p>
    <p>Please come 15 min before your appointment</p>
    <p>See you soon....</p>
    </div>
    `
  };
  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    }
    else {
      console.log('Message sent: ' + info.response);
    }
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
    const doctorCollection = client.db('Doctor_Services').collection('doctor');

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({ email: requester });
      if (requesterAccount.role === 'admin') {
        next();
      } else {
        res.status(403).send({ message: 'Forbidden' })
      }
    }

    app.get('/services', async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/service', async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    });

    app.delete('/doctors/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
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

    app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doc = req.body;
      const result = await doctorCollection.insertOne(doc);
      res.send(result);
    })

    app.get('/allusers', verifyJWT, async (req, res) => {
      const reuslt = await userCollection.find().toArray();
      res.send(reuslt);
    });

    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === 'admin';
      res.send({ admin: isAdmin });
    })

    app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);

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
    });

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
    });

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
      console.log('sending email...');
      sendAppointmentEmail(doc);
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