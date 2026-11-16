import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToString } from "react-dom/server";
import ClientApp from "./client-app";

test("browser-only app server-renders a deterministic accessible loading shell", () => {
  const html = renderToString(React.createElement(ClientApp));
  assert.equal(
    html,
    '<div class="boot" aria-busy="true" aria-label="Loading Valo"><span class="boot-mark">V</span></div>',
  );
  assert.doesNotMatch(html, /BAILOUT_TO_CLIENT_SIDE_RENDERING|<template|window\.location/);
});

test("repeated server renders do not depend on browser state or chunk readiness", () => {
  const first = renderToString(React.createElement(ClientApp));
  const second = renderToString(React.createElement(ClientApp));
  assert.equal(second, first);
});
