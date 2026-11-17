import app from "../app";
if (
  process.env.NODE_ENV !== "development" ||
  process.env.VALO_RUN_REQUEST_BUDGET_TESTS !== "synthetic-development-only" ||
  !process.send
)
  throw Error("Synthetic local IPC harness only");
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") process.send?.({ port: address.port });
});
