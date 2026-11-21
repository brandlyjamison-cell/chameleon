import { afterAll, beforeAll } from "vitest";
import { connect, disconnect } from "./helpers";

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnect();
});
