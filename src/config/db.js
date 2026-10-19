const mongoose = require("mongoose");

// MongoDB connection
const MONGODB_URI =
  "mongodb+srv://shurokkha_user:AfwoQV7IIl2UwjWd@cluster0.icnwzoy.mongodb.net/shurokkhaai?retryWrites=true&w=majority";

let connectionPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
      })
      .catch((error) => {
        connectionPromise = null;
        throw error;
      });
  }

  await connectionPromise;
  return mongoose.connection;
};

module.exports = connectDB;
