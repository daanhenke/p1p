#!/usr/bin/env node
// persona1 CLI: the p1p framework pre-wired with the Persona 1 (US) profile.
// Provides: dump, compile, build commands for Persona 1.
import { runCli } from "@p1p/cli";
import { persona1 } from "./profile.js";
runCli([persona1]);
