import example from "../../../backend/app/example.json";
import { PhotoMeasurementSchema } from "./types";

export const EXAMPLE = PhotoMeasurementSchema.parse(example);
