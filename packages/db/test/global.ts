import { afterAll, beforeAll } from "vitest";
import { connect, disconnect } from "./helpers.js";

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnect();
});
