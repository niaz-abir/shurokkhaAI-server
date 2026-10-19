const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const connectDB = require("./config/db");

const app = express();

// ==========================================
// CORS CONFIGURATION
// ==========================================

const allowedOrigins = [
  "http://localhost:3000",
  "https://shurokkha-ai.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "1mb" }));

// ==========================================
// DATABASE CONNECTION MIDDLEWARE
// ==========================================

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("Database connection error:", error.message);

    return res.status(503).json({
      success: false,
      message: "Database connection unavailable.",
    });
  }
});

// ==========================================
// HOME & HEALTH CHECK
// ==========================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ShurokkhaAI API is running",
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is healthy",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// COMMUNITY REPORTS
// ==========================================

// Submit a community report
app.post("/api/reports", async (req, res) => {
  try {
    const { category, title, description, location } = req.body;

    if (!category || !title || !description || !location) {
      return res.status(400).json({
        success: false,
        message: "Category, title, description, and location are required.",
      });
    }

    const now = new Date();

    const report = {
      category,
      title,
      description,
      location,
      createdAt: now,
      updatedAt: now,
    };

    const result = await mongoose.connection
      .collection("reports")
      .insertOne(report);

    return res.status(201).json({
      success: true,
      message: "Community report submitted successfully.",
      data: {
        _id: result.insertedId,
        ...report,
      },
    });
  } catch (error) {
    console.error("Submit report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to submit community report.",
    });
  }
});

// Get all community reports
app.get("/api/reports", async (req, res) => {
  try {
    const reports = await mongoose.connection
      .collection("reports")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: reports.length,
      data: reports,
    });
  } catch (error) {
    console.error("Fetch reports error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch community reports.",
    });
  }
});

// Delete a community report
app.delete("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid report ID.",
      });
    }

    const result = await mongoose.connection.collection("reports").deleteOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Report not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Report deleted successfully.",
    });
  } catch (error) {
    console.error("Delete report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to delete report.",
    });
  }
});

// ==========================================
// LIVE MAP
// ==========================================

// Create a tracking session or update an existing session
app.post("/api/live-map", async (req, res) => {
  try {
    const { name, latitude, longitude, trackingId } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      latitude === undefined ||
      longitude === undefined ||
      !Number.isFinite(Number(latitude)) ||
      !Number.isFinite(Number(longitude)) ||
      Number(latitude) < -90 ||
      Number(latitude) > 90 ||
      Number(longitude) < -180 ||
      Number(longitude) > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid name, latitude, and longitude are required.",
      });
    }

    const now = new Date();

    const currentLocation = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      timestamp: now,
    };

    const locationsCollection = mongoose.connection.collection("liveLocations");

    // Update an existing active tracking session
    if (trackingId) {
      if (!mongoose.isValidObjectId(trackingId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid tracking ID.",
        });
      }

      const result = await locationsCollection.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(trackingId),
          status: "Active",
        },
        {
          $set: {
            currentLocation,
            updatedAt: now,
          },
          $push: {
            locationHistory: currentLocation,
          },
        },
        {
          returnDocument: "after",
        },
      );

      const updatedLocation = result?.value ?? result;

      if (!updatedLocation) {
        return res.status(404).json({
          success: false,
          message: "Active tracking session not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Location updated successfully.",
        data: updatedLocation,
      });
    }

    // Create a new tracking session
    const newLocation = {
      name: name.trim(),
      status: "Active",
      currentLocation,
      locationHistory: [currentLocation],
      createdAt: now,
      updatedAt: now,
    };

    const result = await locationsCollection.insertOne(newLocation);

    return res.status(201).json({
      success: true,
      message: "Live location tracking started.",
      data: {
        _id: result.insertedId,
        ...newLocation,
      },
    });
  } catch (error) {
    console.error("Live map submission error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to save live location.",
    });
  }
});

// Get live location records
app.get("/api/live-map", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status === "Active" || status === "Stopped") {
      filter.status = status;
    }

    const locations = await mongoose.connection
      .collection("liveLocations")
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: locations.length,
      data: locations,
    });
  } catch (error) {
    console.error("Fetch live locations error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch live locations.",
    });
  }
});

// ==========================================
// EXPORT APP FOR VERCEL
// ==========================================

module.exports = app;
