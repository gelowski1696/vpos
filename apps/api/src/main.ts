import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";

function isPrivateLanWebOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    const allowedPorts = new Set(["3000", "1420", "1421"]);

    if (!allowedPorts.has(port)) {
      return false;
    }

    if (/^10\.\d+\.\d+\.\d+$/.test(host)) {
      return true;
    }
    if (/^192\.168\.\d+\.\d+$/.test(host)) {
      return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: "50mb" }));
  app.use(urlencoded({ limit: "50mb", extended: true }));
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";
  const isProduction = (process.env.NODE_ENV ?? "").toLowerCase() === "production";

  const configuredOrigins = new Set(
    (
    process.env.CORS_ORIGINS ?? "http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  );

  if (!isProduction) {
    configuredOrigins.add("http://localhost:3000");
    configuredOrigins.add("http://127.0.0.1:3000");
    configuredOrigins.add("http://0.0.0.0:3000");
    configuredOrigins.add("http://localhost:1420");
    configuredOrigins.add("http://127.0.0.1:1420");
    configuredOrigins.add("http://0.0.0.0:1420");
    configuredOrigins.add("http://localhost:1421");
    configuredOrigins.add("http://127.0.0.1:1421");
    configuredOrigins.add("http://0.0.0.0:1421");
  }

  configuredOrigins.add("tauri://localhost");
  configuredOrigins.add("https://tauri.localhost");
  configuredOrigins.add("http://tauri.localhost");
  configuredOrigins.add("app://localhost");
  configuredOrigins.add("https://app.localhost");
  configuredOrigins.add("http://app.localhost");

  const allowAllOrigins = configuredOrigins.has("*");

  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowAllOrigins ||
        configuredOrigins.has(origin) ||
        (!isProduction && isPrivateLanWebOrigin(origin))
      ) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-VPOS-Client",
      "X-Client-Channel",
      "X-Client-Id",
      "X-Platform-Owner-Key",
      "X-Vcard-Admin-Key"
    ],
    credentials: true,
  });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(port, host);
}

void bootstrap();
