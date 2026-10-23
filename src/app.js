const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const connectDB = require("./config/db");

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "https://shurokkha-ai.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "1mb" }));

// Connect MongoDB before handling API requests.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("Database connection error:", error);
    res.status(503).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// Health checks
app.get("/", (req, res) => {
  res.json({ success: true, message: "ShurokkhaAI API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    databaseState: mongoose.connection.readyState,
  });
});

// MongoDB collections
const reportsCollection = () => mongoose.connection.collection("reports");

const liveLocationsCollection = () =>
  mongoose.connection.collection("liveLocations");

const areaReportsCollection = () =>
  mongoose.connection.collection("areaReports");

// ObjectId validation helper
const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) &&
  String(new mongoose.Types.ObjectId(id)) === id;

// Validate and normalize an area report.
function validateAreaReport(body, partial = false) {
  const fields = [
    "name",
    "safety",
    "threats",
    "resolved",
    "active",
    "risk",
    "latitude",
    "longitude",
  ];

  const data = {};

  for (const field of fields) {
    if (partial && body[field] === undefined) continue;
    data[field] = body[field];
  }

  if (!partial) {
    for (const field of fields) {
      if (body[field] === undefined || body[field] === "") {
        return { error: `${field} is required` };
      }
    }
  }

  if (
    data.name !== undefined &&
    (typeof data.name !== "string" || !data.name.trim())
  ) {
    return { error: "Area name must be a non-empty string" };
  }

  if (data.name !== undefined) {
    data.name = data.name.trim();
  }

  if (
    data.risk !== undefined &&
    !["High", "Moderate", "Low"].includes(data.risk)
  ) {
    return { error: "Risk must be High, Moderate, or Low" };
  }

  const numericFields = [
    "safety",
    "threats",
    "resolved",
    "active",
    "latitude",
    "longitude",
  ];

  for (const field of numericFields) {
    if (data[field] === undefined) continue;

    const value = Number(data[field]);

    if (!Number.isFinite(value)) {
      return { error: `${field} must be a valid number` };
    }

    data[field] = value;
  }

  if (data.safety !== undefined && (data.safety < 0 || data.safety > 100)) {
    return { error: "Safety must be between 0 and 100" };
  }

  for (const field of ["threats", "resolved", "active"]) {
    if (
      data[field] !== undefined &&
      (!Number.isInteger(data[field]) || data[field] < 0)
    ) {
      return { error: `${field} must be a non-negative integer` };
    }
  }

  if (
    data.latitude !== undefined &&
    (data.latitude < -90 || data.latitude > 90)
  ) {
    return { error: "Latitude must be between -90 and 90" };
  }

  if (
    data.longitude !== undefined &&
    (data.longitude < -180 || data.longitude > 180)
  ) {
    return { error: "Longitude must be between -180 and 180" };
  }

  return { data };
}

// =====================================================
// COMMUNITY REPORTS — existing endpoints
// =====================================================

// Create community report
app.post("/api/reports", async (req, res) => {
  try {
    const { category, title, description, location } = req.body;

    if (!category || !title || !description || !location) {
      return res.status(400).json({
        success: false,
        message: "Category, title, description, and location are required",
      });
    }

    const report = {
      category,
      title,
      description,
      location,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await reportsCollection().insertOne(report);

    res.status(201).json({
      success: true,
      message: "Community report created successfully",
      data: { _id: result.insertedId, ...report },
    });
  } catch (error) {
    console.error("Create community report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create community report",
    });
  }
});

// Get all community reports
app.get("/api/reports", async (req, res) => {
  try {
    const data = await reportsCollection()
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("Get community reports error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch community reports",
    });
  }
});

// Delete community report
app.delete("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid report ID",
      });
    }

    const result = await reportsCollection().deleteOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        success: false,
        message: "Community report not found",
      });
    }

    res.json({
      success: true,
      message: "Community report deleted successfully",
    });
  } catch (error) {
    console.error("Delete community report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete community report",
    });
  }
});

// =====================================================
// LIVE MAP — existing endpoints
// =====================================================

// Create a live location session or update an active session
app.post("/api/live-map", async (req, res) => {
  try {
    const { name, latitude, longitude, trackingId } = req.body;

    if (
      !name ||
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
        message: "Valid name, latitude, and longitude are required",
      });
    }

    const now = new Date();

    const currentLocation = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      timestamp: now,
    };

    if (trackingId) {
      if (!isValidObjectId(trackingId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid tracking ID",
        });
      }

      const result = await liveLocationsCollection().findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(trackingId),
          status: "Active",
        },
        {
          $set: { currentLocation, updatedAt: now },
          $push: { locationHistory: currentLocation },
        },
        { returnDocument: "after" },
      );

      if (!result) {
        return res.status(404).json({
          success: false,
          message: "Active tracking session not found",
        });
      }

      return res.json({
        success: true,
        message: "Live location updated",
        data: result,
      });
    }

    const session = {
      name: name.trim(),
      status: "Active",
      currentLocation,
      locationHistory: [currentLocation],
      createdAt: now,
      updatedAt: now,
    };

    const result = await liveLocationsCollection().insertOne(session);

    res.status(201).json({
      success: true,
      message: "Live location session created",
      data: { _id: result.insertedId, ...session },
    });
  } catch (error) {
    console.error("Live map error:", error);
    res.status(500).json({
      success: false,
      message: "Live map request failed",
    });
  }
});

// Get live location sessions
app.get("/api/live-map", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status === "Active" || status === "Stopped") {
      filter.status = status;
    }

    const data = await liveLocationsCollection()
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("Get live map error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch live locations",
    });
  }
});

// =====================================================
// AREA REPORTS — new full CRUD API
// Base URL: /api/area-reports
// =====================================================

// POST: create an area report
app.post("/api/area-reports", async (req, res) => {
  try {
    const { error, data } = validateAreaReport(req.body);

    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const now = new Date();

    const areaReport = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    const result = await areaReportsCollection().insertOne(areaReport);

    console.log("New area report:", {
      _id: result.insertedId,
      ...areaReport,
    });

    res.status(201).json({
      success: true,
      message: "Area report created successfully",
      data: { _id: result.insertedId, ...areaReport },
    });
  } catch (error) {
    console.error("Create area report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create area report",
    });
  }
});

// GET: fetch all area reports
app.get("/api/area-reports", async (req, res) => {
  try {
    const data = await areaReportsCollection()
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("Get area reports error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch area reports",
    });
  }
});

// GET: fetch one area report by ID
app.get("/api/area-reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid area report ID",
      });
    }

    const data = await areaReportsCollection().findOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Area report not found",
      });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error("Get area report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch area report",
    });
  }
});

// PUT: edit an area report
app.put("/api/area-reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid area report ID",
      });
    }

    const { error, data } = validateAreaReport(req.body, true);

    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update",
      });
    }

    const result = await areaReportsCollection().findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { ...data, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Area report not found",
      });
    }

    res.json({
      success: true,
      message: "Area report updated successfully",
      data: result,
    });
  } catch (error) {
    console.error("Update area report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update area report",
    });
  }
});

// DELETE: delete an area report
app.delete("/api/area-reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid area report ID",
      });
    }

    const result = await areaReportsCollection().deleteOne({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        success: false,
        message: "Area report not found",
      });
    }

    res.json({
      success: true,
      message: "Area report deleted successfully",
    });
  } catch (error) {
    console.error("Delete area report error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete area report",
    });
  }
});

module.exports = app;
