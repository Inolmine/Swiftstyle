import example from "./example.json";
import { PhotoMeasurementSchema } from "./types";

export const EXAMPLE = PhotoMeasurementSchema.parse(example);
