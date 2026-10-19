const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:8000",
  }),
);

app.use(express.json({ limit: "1mb" }));

// Health check
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
    timestamp: new Date().toISOString(),
  });
});

// Create Community Report
app.post("/api/reports", async (req, res) => {
  try {
    const {
      category,
      title,
      description,
      location,
      name,
      email,
      isAnonymous,
      imageUrl,
    } = req.body;

    if (!category || !title || !description || !location) {
      return res.status(400).json({
        success: false,
        message: "Category, title, description, and location are required.",
      });
    }

    const report = {
      category,
      title,
      description,
      location,
      name: isAnonymous ? null : name || null,
      email: isAnonymous ? null : email || null,
      isAnonymous: isAnonymous === true,
      imageUrl: imageUrl || null,
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await mongoose.connection
      .collection("reports")
      .insertOne(report);

    console.log("Community report created:", result.insertedId.toString());

    return res.status(201).json({
      success: true,
      message: "Community report submitted successfully.",
      data: {
        _id: result.insertedId,
        ...report,
      },
    });
  } catch (error) {
    console.error("Create community report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to submit community report.",
    });
  }
});

// Get All Community Reports
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
    console.error("Get community reports error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch community reports.",
    });
  }
});

// Delete Community Report
app.delete("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
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

    console.log("Community report deleted:", id);

    return res.status(200).json({
      success: true,
      message: "Community report deleted successfully.",
      id,
    });
  } catch (error) {
    console.error("Delete community report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to delete community report.",
    });
  }
});

// ==========================================
// LIVE MAP API 1: Create / Update Live Location
// POST /api/live-map
// ==========================================
app.post("/api/live-map", async (req, res) => {
  try {
    const { name, latitude, longitude, trackingId } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name is required.",
      });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid latitude and longitude are required.",
      });
    }

    const collection = mongoose.connection.collection("liveLocations");
    const now = new Date();

    // Existing tracking session: append a new location point.
    if (trackingId) {
      if (!mongoose.Types.ObjectId.isValid(trackingId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid tracking ID.",
        });
      }

      const result = await collection.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(trackingId),
          status: "Active",
        },
        {
          $set: {
            currentLocation: {
              latitude: lat,
              longitude: lng,
              updatedAt: now,
            },
            updatedAt: now,
          },
          $push: {
            locationHistory: {
              latitude: lat,
              longitude: lng,
              timestamp: now,
            },
          },
        },
        { returnDocument: "after" },
      );

      // Compatible with MongoDB driver versions returning either
      // the document directly or a result object containing `value`.
      const updatedRecord = result?.value ?? result;

      if (!updatedRecord) {
        return res.status(404).json({
          success: false,
          message: "Active tracking session not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Live location updated successfully.",
        data: updatedRecord,
      });
    }

    // New tracking session.
    const newTracking = {
      name: name.trim(),
      status: "Active",
      currentLocation: {
        latitude: lat,
        longitude: lng,
        updatedAt: now,
      },
      locationHistory: [
        {
          latitude: lat,
          longitude: lng,
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const result = await collection.insertOne(newTracking);

    return res.status(201).json({
      success: true,
      message: "Live location tracking started successfully.",
      data: {
        _id: result.insertedId,
        ...newTracking,
      },
    });
  } catch (error) {
    console.error("Live Map POST error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to save live location.",
    });
  }
});

// ==========================================
// LIVE MAP API 2: Get Tracking Records
// GET /api/live-map
// ==========================================
app.get("/api/live-map", async (req, res) => {
  try {
    const { status } = req.query;

    const filter = {};

    if (status === "Active" || status === "Stopped") {
      filter.status = status;
    }

    const records = await mongoose.connection
      .collection("liveLocations")
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: records.length,
      data: records,
    });
  } catch (error) {
    console.error("Live Map GET error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch live location records.",
    });
  }
});

module.exports = app;
