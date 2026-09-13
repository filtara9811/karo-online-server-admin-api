import { Router } from "express";
import { asyncHandler, fail, ok, zodFail } from "../lib/respond.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import {
  DirectionsSchema,
  DistanceSchema,
  GeocodeSchema,
  PlaceDetailsSchema,
  PlacesSchema,
  ReverseSchema,
  directions,
  distanceMatrix,
  geocode,
  placeDetails,
  placesAutocomplete,
  reverseGeocode,
} from "../lib/maps.js";

export const mapsRouter = Router();
mapsRouter.use(requireAuth);

function mapsKey(res: import("express").Response) {
  if (env.googleMapsServerKey) return false;
  fail(res, 503, "GOOGLE_MAPS_SERVER_KEY is not set");
  return true;
}

mapsRouter.post(
  "/geocode",
  asyncHandler(async (req, res) => {
    if (mapsKey(res)) return;
    const parsed = GeocodeSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await geocode(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? result.status, result);
  }),
);

mapsRouter.post(
  "/reverse",
  asyncHandler(async (req, res) => {
    if (mapsKey(res)) return;
    const parsed = ReverseSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await reverseGeocode(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? result.status, result);
  }),
);

mapsRouter.post(
  "/distance",
  asyncHandler(async (req, res) => {
    if (mapsKey(res)) return;
    const parsed = DistanceSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await distanceMatrix(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? result.status, result);
  }),
);

mapsRouter.post(
  "/places",
  asyncHandler(async (req, res) => {
    if (mapsKey(res)) return;
    const parsed = PlacesSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await placesAutocomplete(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? result.status, result);
  }),
);

mapsRouter.post(
  "/place-details",
  asyncHandler(async (req, res) => {
    if (mapsKey(res)) return;
    const parsed = PlaceDetailsSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await placeDetails(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? result.status, result);
  }),
);

mapsRouter.post(
  "/directions",
  asyncHandler(async (req, res) => {
    if (mapsKey(res)) return;
    const parsed = DirectionsSchema.safeParse(req.body);
    if (!parsed.success) return zodFail(res, parsed.error);
    const result = await directions(parsed.data);
    return result.ok ? ok(res, result) : fail(res, 400, result.error ?? result.status, result);
  }),
);
