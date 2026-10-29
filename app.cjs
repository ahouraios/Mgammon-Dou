var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
__export(server_exports, {
  createApp: () => createApp,
  startServer: () => startServer
});
module.exports = __toCommonJS(server_exports);
var import_config = require("dotenv/config");
var import_express2 = __toESM(require("express"), 1);
var import_cookie_parser = __toESM(require("cookie-parser"), 1);
var import_path4 = __toESM(require("path"), 1);
var import_fs4 = __toESM(require("fs"), 1);

// src/server/db.ts
var import_promise = __toESM(require("mysql2/promise"), 1);
var import_bcryptjs = __toESM(require("bcryptjs"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_child_process = require("child_process");
var import_util = require("util");
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var pool = null;
var currentPoolDbName = "";
var dbInitialized = false;
var dbInitializingPromise = null;
var lastDbError = null;
var localMariaDbBootstrapped = false;
var localMariaDbBootstrapPromise = null;
var simulatedDisconnect = false;
var simulatedMidTxFailureTag = null;
var PLACEHOLDER_DB_USERS = /* @__PURE__ */ new Set(["", "cpanel_username_mgammon", "your_db_user"]);
var PLACEHOLDER_DB_PASSWORDS = /* @__PURE__ */ new Set(["", "YOUR_STRONG_MYSQL_PASSWORD", "your_db_password"]);
var PLACEHOLDER_DB_NAMES = /* @__PURE__ */ new Set(["", "cpanel_username_mgammon_duo", "your_db_name"]);
function sanitizeDbErrorMessage(err) {
  const raw = err instanceof Error ? err.message : String(err || "Unknown database error");
  return raw.replace(/(password|passwd|pwd|token|secret|authorization|key)\s*[:=]\s*[^\s,;'"&]+/gi, "$1=[REDACTED]").replace(/using password:\s*(YES|NO)/gi, "using password: [REDACTED]").replace(/'[^']*'@'[^']*'/g, "'[USER]'@'[HOST]'");
}
function isCpanelOrProductionEnvironment(env = process.env) {
  if (env.NODE_ENV === "production") return true;
  if (env.CPANEL_ENV === "true" || env.CPANEL === "1") return true;
  const rawUser = (env.DB_USER || "").trim();
  if (rawUser && !PLACEHOLDER_DB_USERS.has(rawUser) && rawUser !== "root") {
    return true;
  }
  return false;
}
function getDbConfig(env = process.env) {
  const rawUser = (env.DB_USER || "").trim();
  const rawPassword = env.DB_PASSWORD || "";
  const rawDbName = (env.DB_NAME || "").trim();
  return {
    host: env.DB_HOST || "127.0.0.1",
    port: Number(env.DB_PORT || 3306),
    user: PLACEHOLDER_DB_USERS.has(rawUser) ? "root" : rawUser,
    password: PLACEHOLDER_DB_PASSWORDS.has(rawPassword) ? "" : rawPassword,
    database: PLACEHOLDER_DB_NAMES.has(rawDbName) ? "mgammon_duo" : rawDbName,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 5e3,
    queueLimit: 0,
    charset: "utf8mb4",
    timezone: "+03:30",
    dateStrings: ["DATE"]
  };
}
async function hasMariadbdBinary() {
  try {
    await execAsync("which mariadbd");
    return true;
  } catch {
    return false;
  }
}
async function ensureLocalMariaDbRunningIfNeeded() {
  if (isCpanelOrProductionEnvironment(process.env)) {
    localMariaDbBootstrapped = true;
    return;
  }
  const cfg = getDbConfig();
  const isLocalHost = cfg.host === "127.0.0.1" || cfg.host === "localhost";
  if (!isLocalHost || cfg.user !== "root") {
    localMariaDbBootstrapped = true;
    return;
  }
  const safeDbName = cfg.database.replace(/[^a-zA-Z0-9_]/g, "");
  try {
    const probeConn = await import_promise.default.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 1500
    });
    await probeConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await probeConn.end();
    localMariaDbBootstrapped = true;
    return;
  } catch {
  }
  if (localMariaDbBootstrapPromise) {
    return localMariaDbBootstrapPromise;
  }
  localMariaDbBootstrapPromise = (async () => {
    try {
      const persistentDataDir = process.env.LOCAL_MARIADB_DATADIR || "/var/lib/mysql";
      const debCacheDir = process.env.LOCAL_DEB_CACHE_DIR || "/var/cache/apt/archives";
      import_fs.default.mkdirSync(debCacheDir, { recursive: true });
      let hasMariadbd = await hasMariadbdBinary();
      if (!hasMariadbd && import_fs.default.existsSync("/etc/debian_version")) {
        try {
          const cachedDebs = import_fs.default.readdirSync(debCacheDir).filter((f) => f.endsWith(".deb"));
          if (cachedDebs.some((f) => f.startsWith("mariadb-server_"))) {
            await execAsync(
              `DEBIAN_FRONTEND=noninteractive dpkg -i --force-confdef --force-confold "${debCacheDir}"/*.deb || DEBIAN_FRONTEND=noninteractive dpkg --configure -a`
            );
          }
        } catch {
        }
        hasMariadbd = await hasMariadbdBinary();
      }
      if (!hasMariadbd && import_fs.default.existsSync("/etc/debian_version")) {
        try {
          if (import_fs.default.existsSync("/etc/apt/sources.list.d/debian.sources") && import_fs.default.existsSync("/etc/apt/sources.list")) {
            import_fs.default.unlinkSync("/etc/apt/sources.list");
          }
          if (import_fs.default.existsSync("/etc/apt/apt.conf.d/docker-clean")) {
            import_fs.default.unlinkSync("/etc/apt/apt.conf.d/docker-clean");
          }
        } catch {
        }
        try {
          await execAsync(
            `DEBIAN_FRONTEND=noninteractive dpkg --configure -a && DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get --fix-broken install -y -o APT::Keep-Downloaded-Packages="true" -o Dir::Cache::archives="${debCacheDir}" && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends -o APT::Keep-Downloaded-Packages="true" -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" -o Dir::Cache::archives="${debCacheDir}" mariadb-server`
          );
          const lockFile = import_path.default.join(debCacheDir, "lock");
          if (import_fs.default.existsSync(lockFile)) {
            import_fs.default.unlinkSync(lockFile);
          }
        } catch {
        }
        hasMariadbd = await hasMariadbdBinary();
      }
      if (!hasMariadbd) {
        return;
      }
      const isSocketReady = () => import_fs.default.existsSync("/run/mysqld/mysqld.sock") || import_fs.default.existsSync("/var/run/mysqld/mysqld.sock");
      const initFreshDataDir = async () => {
        import_fs.default.rmSync(persistentDataDir, { recursive: true, force: true });
        import_fs.default.mkdirSync(persistentDataDir, { recursive: true });
        await execAsync(`chown -R mysql:mysql /run/mysqld "${persistentDataDir}"`);
        await execAsync(
          `mariadb-install-db --user=mysql --datadir="${persistentDataDir}" --innodb-log-file-size=8M --auth-root-authentication-method=normal`
        );
      };
      const spawnMariadbdAndWait = async () => {
        try {
          await execAsync(`chown -R mysql:mysql /run/mysqld "${persistentDataDir}"`);
        } catch {
        }
        const child = (0, import_child_process.spawn)(
          "mariadbd",
          [
            "--user=mysql",
            `--datadir=${persistentDataDir}`,
            "--innodb-log-file-size=8M",
            "--socket=/run/mysqld/mysqld.sock",
            "--pid-file=/run/mysqld/mysqld.pid",
            "--bind-address=127.0.0.1",
            "--port=3306"
          ],
          {
            detached: true,
            stdio: "ignore"
          }
        );
        child.on("error", () => {
        });
        child.unref();
        for (let i = 0; i < 30; i++) {
          if (isSocketReady()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return isSocketReady();
      };
      if (!isSocketReady()) {
        import_fs.default.mkdirSync("/run/mysqld", { recursive: true });
        import_fs.default.mkdirSync(persistentDataDir, { recursive: true });
        if (!import_fs.default.existsSync(import_path.default.join(persistentDataDir, "mysql")) || !import_fs.default.existsSync(import_path.default.join(persistentDataDir, "ibdata1"))) {
          try {
            await initFreshDataDir();
          } catch {
          }
        }
        let started = await spawnMariadbdAndWait();
        if (!started) {
          try {
            await initFreshDataDir();
            started = await spawnMariadbdAndWait();
          } catch {
          }
        }
      }
      await execAsync(
        `mysql -u root -e "CREATE DATABASE IF NOT EXISTS \\\`${safeDbName}\\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD(''); GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' IDENTIFIED VIA mysql_native_password USING PASSWORD('') WITH GRANT OPTION; FLUSH PRIVILEGES;"`
      );
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const tcpConn = await import_promise.default.createConnection({
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            password: cfg.password,
            connectTimeout: 1500
          });
          await tcpConn.query(
            `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
          );
          await tcpConn.end();
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    } catch {
    } finally {
      localMariaDbBootstrapped = true;
      localMariaDbBootstrapPromise = null;
    }
  })();
  return localMariaDbBootstrapPromise;
}
function getSimulatedMidTransactionFailure() {
  return simulatedMidTxFailureTag;
}
function isDatabaseInitialized() {
  const cfg = getDbConfig();
  return dbInitialized && !simulatedDisconnect && currentPoolDbName === cfg.database;
}
async function waitForPendingDatabaseInit() {
  if (dbInitializingPromise) {
    try {
      await dbInitializingPromise;
    } catch {
    }
  }
}
function getPool() {
  if (simulatedDisconnect) {
    throw new Error("SIMULATED_DB_DISCONNECT");
  }
  const cfg = getDbConfig();
  if (!pool || currentPoolDbName !== cfg.database) {
    if (pool) {
      pool.end().catch(() => {
      });
    }
    pool = import_promise.default.createPool(cfg);
    currentPoolDbName = cfg.database;
  }
  return pool;
}
async function withTransaction(fn, operationTag) {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    if (simulatedDisconnect || operationTag && simulatedMidTxFailureTag === operationTag) {
      throw new Error("SIMULATED_DB_DISCONNECT");
    }
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
    }
    throw err;
  } finally {
    conn.release();
  }
}
async function checkDatabaseConnection() {
  if (simulatedDisconnect) {
    return {
      connected: false,
      initialized: false,
      message: "\u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u067E\u0627\u06CC\u06AF\u0627\u0647 \u062F\u0627\u062F\u0647 MySQL \u0645\u0648\u0642\u062A\u0627\u064B \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A."
    };
  }
  if (process.env.SIMULATE_DB_DOWN === "true") {
    return {
      connected: false,
      initialized: false,
      message: "\u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u0633\u0631\u0648\u0631 \u0628\u0631\u0642\u0631\u0627\u0631 \u0646\u06CC\u0633\u062A."
    };
  }
  if (!isDatabaseInitialized()) {
    return {
      connected: false,
      initialized: false,
      message: lastDbError || "\u067E\u0627\u06CC\u06AF\u0627\u0647 \u062F\u0627\u062F\u0647 \u0647\u0646\u0648\u0632 \u0622\u0645\u0627\u062F\u0647 \u0628\u0647\u0631\u0647\u200C\u0628\u0631\u062F\u0627\u0631\u06CC \u0646\u06CC\u0633\u062A."
    };
  }
  try {
    const p = getPool();
    await p.execute("SELECT 1 AS ok");
    return { connected: true, initialized: true };
  } catch (err) {
    lastDbError = sanitizeDbErrorMessage(err);
    return {
      connected: false,
      initialized: false,
      message: "\u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u0633\u0631\u0648\u0631 \u0628\u0631\u0642\u0631\u0627\u0631 \u0646\u06CC\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0627\u062A\u0635\u0627\u0644 \u0631\u0627 \u0628\u0631\u0631\u0633\u06CC \u06A9\u0646\u06CC\u062F."
    };
  }
}
var FORBIDDEN_DEFAULT_SECRETS = /* @__PURE__ */ new Set([
  "",
  "mgammon-duo-default-server-secret-2026",
  "mgammon-duo-enterprise-secret-2026",
  "CHANGE_THIS_TO_A_STRONG_64_CHAR_RANDOM_SECRET_KEY",
  "replace_with_a_long_random_64_char_secret_string",
  "secret",
  "changeme"
]);
var FORBIDDEN_DEFAULT_PASSWORDS = /* @__PURE__ */ new Set([
  "Mgammon@1405",
  "Worker@1405",
  "CHANGE_ME_MANAGER_PASSWORD",
  "CHANGE_ME_WORKER_PASSWORD",
  "123456",
  "12345678",
  "password",
  "admin"
]);
function validateProductionSecurityConfig(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const sessionSecret = (env.SESSION_SECRET || "").trim();
  if (!sessionSecret || sessionSecret.length < 32 || FORBIDDEN_DEFAULT_SECRETS.has(sessionSecret)) {
    throw new Error(
      "SECURITY_CONFIG_ERROR: \u0645\u062A\u063A\u06CC\u0631 \u0645\u062D\u06CC\u0637\u06CC SESSION_SECRET \u062F\u0631 \u0645\u062D\u06CC\u0637 \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC (Production) \u062E\u0627\u0644\u06CC\u060C \u06A9\u0648\u062A\u0627\u0647\u200C\u062A\u0631 \u0627\u0632 \u06F3\u06F2 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u06CC\u0627 \u062F\u0627\u0631\u0627\u06CC \u0645\u0642\u062F\u0627\u0631 \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u0627\u0633\u062A. \u0631\u0627\u0647\u200C\u0627\u0646\u062F\u0627\u0632\u06CC \u0633\u0631\u0648\u0631 \u0645\u062A\u0648\u0642\u0641 \u0634\u062F."
    );
  }
  const mgrPass = (env.INITIAL_MANAGER_PASSWORD || "").trim();
  const wrkPass = (env.INITIAL_WORKER_PASSWORD || "").trim();
  if (mgrPass && (mgrPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(mgrPass)) || wrkPass && (wrkPass.length < 8 || FORBIDDEN_DEFAULT_PASSWORDS.has(wrkPass))) {
    throw new Error(
      "SECURITY_CONFIG_ERROR: \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0627\u0632 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u06CC\u0627 \u0636\u0639\u06CC\u0641 \u0628\u0631\u0627\u06CC \u062D\u0633\u0627\u0628\u200C\u0647\u0627\u06CC \u0627\u0648\u0644\u06CC\u0647 \u062F\u0631 \u0645\u062D\u06CC\u0637 \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC (Production) \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A."
    );
  }
}
async function columnExists(p, tableName, columnName) {
  const [rows] = await p.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}
async function ensureColumnExists(p, tableName, columnName, columnDefinitionSql) {
  const exists = await columnExists(p, tableName, columnName);
  if (exists) return false;
  await p.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDefinitionSql}`);
  return true;
}
async function indexExists(p, tableName, indexName) {
  const [rows] = await p.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}
async function ensureIndexExists(p, tableName, indexName, indexSql) {
  const exists = await indexExists(p, tableName, indexName);
  if (exists) return false;
  await p.query(`ALTER TABLE \`${tableName}\` ADD ${indexSql}`);
  return true;
}
async function foreignKeyExists(p, tableName, constraintName) {
  const [rows] = await p.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     LIMIT 1`,
    [tableName, constraintName]
  );
  return rows.length > 0;
}
async function ensureForeignKeyExists(p, tableName, constraintName, fkDefinitionSql) {
  const exists = await foreignKeyExists(p, tableName, constraintName);
  if (exists) return false;
  await p.query(
    `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${constraintName}\` ${fkDefinitionSql}`
  );
  return true;
}
var SCHEMA_MIGRATIONS = [
  {
    version: 1,
    name: "v1_base_tables_and_core_constraints",
    up: async (p) => {
      await ensureIndexExists(p, "users", "uq_users_username", "UNIQUE KEY `uq_users_username` (`username`)");
      await ensureIndexExists(p, "users", "uq_users_single_role", "UNIQUE KEY `uq_users_single_role` (`role`)");
      await ensureIndexExists(
        p,
        "user_sessions",
        "idx_sessions_user_expires",
        "KEY `idx_sessions_user_expires` (`user_id`, `expires_at`)"
      );
      await ensureIndexExists(
        p,
        "attendance_logs",
        "idx_attendance_user_date",
        "KEY `idx_attendance_user_date` (`user_id`, `work_date`, `is_deleted`)"
      );
      await ensureIndexExists(
        p,
        "attendance_logs",
        "idx_attendance_shamsi",
        "KEY `idx_attendance_shamsi` (`shamsi_date`)"
      );
    }
  },
  {
    version: 2,
    name: "v2_users_profile_biometric_and_password_policy",
    up: async (p) => {
      await ensureColumnExists(p, "users", "avatar_url", "MEDIUMTEXT NULL DEFAULT NULL");
      await ensureColumnExists(
        p,
        "users",
        "collaboration_start_shamsi",
        "VARCHAR(10) NULL DEFAULT '1405/06/15'"
      );
      await ensureColumnExists(p, "users", "phone_number", "VARCHAR(20) NULL DEFAULT NULL");
      await ensureColumnExists(
        p,
        "users",
        "biometric_credential_id",
        "VARCHAR(255) NULL DEFAULT NULL"
      );
      await ensureColumnExists(p, "users", "biometric_token_hash", "VARCHAR(255) NULL DEFAULT NULL");
      await ensureColumnExists(
        p,
        "users",
        "must_change_password",
        "TINYINT(1) NOT NULL DEFAULT 0"
      );
    }
  },
  {
    version: 3,
    name: "v3_historical_work_and_daily_reports_attachments",
    up: async (p) => {
      await ensureColumnExists(
        p,
        "historical_work_records",
        "status",
        "ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED'"
      );
      await ensureColumnExists(
        p,
        "historical_work_records",
        "excel_file_url",
        "MEDIUMTEXT NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "historical_work_records",
        "excel_file_name",
        "VARCHAR(255) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "historical_work_records",
        "parsed_rows_json",
        "LONGTEXT NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "historical_work_records",
        "is_seen_by_manager",
        "TINYINT(1) NOT NULL DEFAULT 0"
      );
      await ensureColumnExists(
        p,
        "historical_work_records",
        "reviewed_by_user_id",
        "INT UNSIGNED NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "historical_work_records",
        "reviewed_at",
        "DATETIME NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "daily_work_reports",
        "is_seen_by_manager",
        "TINYINT(1) NOT NULL DEFAULT 0"
      );
      await ensureColumnExists(p, "daily_work_reports", "photo_url", "MEDIUMTEXT NULL DEFAULT NULL");
      await ensureColumnExists(
        p,
        "daily_work_reports",
        "photo_name",
        "VARCHAR(255) NULL DEFAULT NULL"
      );
    }
  },
  {
    version: 4,
    name: "v4_financial_receipts_and_system_settings_extensions",
    up: async (p) => {
      await ensureColumnExists(
        p,
        "financial_transactions",
        "is_seen_by_manager",
        "TINYINT(1) NOT NULL DEFAULT 0"
      );
      await ensureColumnExists(
        p,
        "financial_transactions",
        "receipt_file_url",
        "MEDIUMTEXT NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "financial_transactions",
        "receipt_file_name",
        "VARCHAR(255) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "financial_transactions",
        "idempotency_key",
        "VARCHAR(64) NULL DEFAULT NULL"
      );
      await ensureIndexExists(
        p,
        "financial_transactions",
        "uq_fin_idempotency",
        "UNIQUE KEY `uq_fin_idempotency` (`idempotency_key`)"
      );
      await ensureColumnExists(p, "system_settings", "banner_bg_url", "MEDIUMTEXT NULL DEFAULT NULL");
      await ensureColumnExists(
        p,
        "system_settings",
        "thursday_shift_start_time",
        "VARCHAR(5) NOT NULL DEFAULT '07:00'"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "thursday_shift_end_time",
        "VARCHAR(5) NOT NULL DEFAULT '14:00'"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "thursday_overtime_start_time",
        "VARCHAR(5) NOT NULL DEFAULT '14:00'"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "base_salary_toman",
        "DECIMAL(15, 0) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "overtime_calc_mode",
        "ENUM('FIXED_RATE', 'PERCENTAGE') NOT NULL DEFAULT 'PERCENTAGE'"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "overtime_percentage",
        "DECIMAL(6, 2) NOT NULL DEFAULT 140.00"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "collaboration_start_shamsi",
        "VARCHAR(10) NOT NULL DEFAULT '1405/06/15'"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "monthly_leave_quota_days",
        "DECIMAL(4, 1) NOT NULL DEFAULT 2.5"
      );
      await ensureColumnExists(p, "system_settings", "sms_enabled", "TINYINT(1) NOT NULL DEFAULT 0");
      await ensureColumnExists(
        p,
        "system_settings",
        "melipayamak_username",
        "VARCHAR(120) NOT NULL DEFAULT ''"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "melipayamak_password",
        "VARCHAR(255) NOT NULL DEFAULT ''"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "melipayamak_from_number",
        "VARCHAR(64) NOT NULL DEFAULT ''"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "melipayamak_is_flash",
        "TINYINT(1) NOT NULL DEFAULT 0"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "worker_phone_number",
        "VARCHAR(20) NOT NULL DEFAULT ''"
      );
    }
  },
  {
    version: 5,
    name: "v5_correspondence_audio_and_foreign_keys",
    up: async (p) => {
      await ensureColumnExists(
        p,
        "work_correspondences",
        "audio_url",
        "MEDIUMTEXT NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "work_correspondences",
        "audio_duration_seconds",
        "INT UNSIGNED NULL DEFAULT NULL"
      );
      await ensureForeignKeyExists(
        p,
        "historical_work_records",
        "fk_hist_work_reviewer",
        "FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL"
      );
      await ensureForeignKeyExists(
        p,
        "leave_requests",
        "fk_leave_reviewer",
        "FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL"
      );
    }
  },
  {
    version: 6,
    name: "v6_idempotency_keys_and_composite_indexes",
    up: async (p) => {
      await ensureColumnExists(
        p,
        "attendance_logs",
        "idempotency_key",
        "VARCHAR(64) NULL DEFAULT NULL"
      );
      await ensureIndexExists(
        p,
        "attendance_logs",
        "uq_attendance_idempotency",
        "UNIQUE KEY `uq_attendance_idempotency` (`idempotency_key`)"
      );
      await ensureColumnExists(
        p,
        "historical_work_records",
        "idempotency_key",
        "VARCHAR(64) NULL DEFAULT NULL"
      );
      await ensureIndexExists(
        p,
        "historical_work_records",
        "uq_hist_idempotency",
        "UNIQUE KEY `uq_hist_idempotency` (`idempotency_key`)"
      );
      await ensureIndexExists(
        p,
        "historical_work_records",
        "idx_hist_work_user_status",
        "KEY `idx_hist_work_user_status` (`user_id`, `status`)"
      );
      await ensureColumnExists(
        p,
        "daily_work_reports",
        "idempotency_key",
        "VARCHAR(64) NULL DEFAULT NULL"
      );
      await ensureIndexExists(
        p,
        "daily_work_reports",
        "uq_reports_idempotency",
        "UNIQUE KEY `uq_reports_idempotency` (`idempotency_key`)"
      );
      await ensureColumnExists(
        p,
        "leave_requests",
        "idempotency_key",
        "VARCHAR(64) NULL DEFAULT NULL"
      );
      await ensureIndexExists(
        p,
        "leave_requests",
        "uq_leaves_idempotency",
        "UNIQUE KEY `uq_leaves_idempotency` (`idempotency_key`)"
      );
      await ensureIndexExists(
        p,
        "financial_transactions",
        "idx_fin_user_status",
        "KEY `idx_fin_user_status` (`user_id`, `status`)"
      );
      await ensureColumnExists(
        p,
        "attendance_logs",
        "late_status",
        "ENUM('NONE', 'PENDING', 'EXCUSED', 'APPROVED_DELAY', 'ABSENCE', 'DEDUCT_LEAVE', 'CUSTOM') NOT NULL DEFAULT 'NONE'"
      );
      await ensureColumnExists(
        p,
        "attendance_logs",
        "late_reason",
        "VARCHAR(500) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "attendance_logs",
        "manager_late_note",
        "VARCHAR(500) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "attendance_logs",
        "custom_deduction_toman",
        "DECIMAL(15, 0) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "attendance_logs",
        "late_reviewed_by_user_id",
        "INT UNSIGNED NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "attendance_logs",
        "late_reviewed_at",
        "DATETIME NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "attendance_logs",
        "is_late_seen_by_worker",
        "TINYINT(1) NOT NULL DEFAULT 1"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "late_deduction_unit",
        "ENUM('MINUTE', 'HOUR') NOT NULL DEFAULT 'MINUTE'"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "late_deduction_rate_toman",
        "DECIMAL(15, 0) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "absence_deduction_unit",
        "ENUM('DAY', 'HOUR') NOT NULL DEFAULT 'DAY'"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "absence_deduction_rate_toman",
        "DECIMAL(15, 0) NULL DEFAULT NULL"
      );
      await ensureColumnExists(
        p,
        "system_settings",
        "sms_on_task_and_message",
        "TINYINT(1) NOT NULL DEFAULT 0"
      );
    }
  }
];
async function createPreMigrationSafetySnapshot(p, targetVersion) {
  try {
    const [uRows] = await p.execute("SELECT COUNT(*) AS cnt FROM users");
    const userCount = Number(uRows[0]?.cnt || 0);
    if (userCount === 0) {
      return null;
    }
    const backupDir = import_path.default.resolve(process.cwd(), ".data/backups");
    import_fs.default.mkdirSync(backupDir, { recursive: true, mode: 448 });
    const tablesToSnap = [
      "users",
      "system_settings",
      "financial_transactions",
      "attendance_logs",
      "historical_work_records",
      "leave_requests",
      "daily_work_reports"
    ];
    const snapshotData = {};
    for (const tbl of tablesToSnap) {
      try {
        const [rows] = await p.query(`SELECT * FROM \`${tbl}\``);
        snapshotData[tbl] = rows;
      } catch {
        snapshotData[tbl] = [];
      }
    }
    const cfg = getDbConfig();
    const fileName = `pre_migration_${cfg.database}_v${targetVersion}_${Date.now()}.json`;
    const fullPath = import_path.default.join(backupDir, fileName);
    const content = JSON.stringify(
      {
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        database: cfg.database,
        targetMigrationVersion: targetVersion,
        tables: snapshotData
      },
      null,
      2
    );
    import_fs.default.writeFileSync(fullPath, content, { mode: 384 });
    return fullPath;
  } catch {
    return null;
  }
}
async function runVersionedMigrations(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`version\` INT UNSIGNED NOT NULL,
      \`name\` VARCHAR(120) NOT NULL,
      \`checksum\` VARCHAR(64) NOT NULL,
      \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`execution_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (\`version\`),
      UNIQUE KEY \`uq_schema_migrations_name\` (\`name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [appliedRows] = await p.execute(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC"
  );
  const appliedMap = /* @__PURE__ */ new Map();
  for (const r of appliedRows) {
    appliedMap.set(Number(r.version), {
      name: String(r.name),
      checksum: String(r.checksum)
    });
  }
  let preMigrationSnapshotPath = null;
  const pendingSpecs = SCHEMA_MIGRATIONS.filter((m) => !appliedMap.has(m.version));
  if (pendingSpecs.length > 0) {
    preMigrationSnapshotPath = await createPreMigrationSafetySnapshot(
      p,
      pendingSpecs[0].version
    );
  }
  const appliedVersions = [];
  for (const mig of SCHEMA_MIGRATIONS) {
    const startMs = Date.now();
    const checksum = import_crypto.default.createHash("sha256").update(`${mig.version}:${mig.name}`).digest("hex");
    await mig.up(p);
    if (!appliedMap.has(mig.version)) {
      const execMs = Math.max(0, Date.now() - startMs);
      await p.execute(
        `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), execution_ms = VALUES(execution_ms)`,
        [mig.version, mig.name, checksum, execMs]
      );
      appliedVersions.push(mig.version);
    }
  }
  return {
    appliedVersions,
    totalMigrations: SCHEMA_MIGRATIONS.length,
    preMigrationSnapshotPath
  };
}
function migrateLegacyPublicMediaToPrivate() {
  const folders = ["avatars", "attachments", "excel", "audio", "receipts", "reports"];
  const privateBaseDir = import_path.default.resolve(process.cwd(), ".data/private_media");
  const legacyPublicMediaDir = import_path.default.resolve(process.cwd(), "public/assets/media");
  for (const folder of folders) {
    try {
      const targetDir = import_path.default.resolve(privateBaseDir, folder);
      import_fs.default.mkdirSync(targetDir, { recursive: true, mode: 448 });
      const legacyDir = import_path.default.resolve(legacyPublicMediaDir, folder);
      if (import_fs.default.existsSync(legacyDir)) {
        const entries = import_fs.default.readdirSync(legacyDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const srcPath = import_path.default.join(legacyDir, entry.name);
          const dstPath = import_path.default.join(targetDir, entry.name);
          if (!import_fs.default.existsSync(dstPath)) {
            import_fs.default.copyFileSync(srcPath, dstPath);
          }
          try {
            import_fs.default.unlinkSync(srcPath);
          } catch {
          }
        }
      }
    } catch {
    }
  }
}
async function initializeDatabase() {
  if (dbInitializingPromise) {
    return dbInitializingPromise;
  }
  dbInitializingPromise = (async () => {
    try {
      validateProductionSecurityConfig(process.env);
      await ensureLocalMariaDbRunningIfNeeded();
      migrateLegacyPublicMediaToPrivate();
      const cfg = getDbConfig();
      const safeDbName = cfg.database.replace(/[^a-zA-Z0-9_]/g, "");
      if (!isCpanelOrProductionEnvironment(process.env) && cfg.user === "root") {
        try {
          const adminConn = await import_promise.default.createConnection({
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            password: cfg.password,
            connectTimeout: 3e3
          });
          await adminConn.query(
            `CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
          );
          await adminConn.end();
        } catch {
        }
      }
      const p = getPool();
      const schemaPath = import_path.default.resolve(process.cwd(), "database/schema.sql");
      const schemaSql = import_fs.default.readFileSync(schemaPath, "utf8");
      const cleanedSql = schemaSql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
      const statements = cleanedSql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter((s) => s.length > 0);
      for (const stmt of statements) {
        await p.query(stmt);
      }
      await runVersionedMigrations(p);
      const [existingUsers] = await p.execute(
        "SELECT id, username, role, full_name, collaboration_start_shamsi FROM users ORDER BY id ASC"
      );
      const hasManager = existingUsers.some((u) => u.role === "manager");
      const hasWorker = existingUsers.some((u) => u.role === "worker");
      const isProd = process.env.NODE_ENV === "production";
      const rawMgrPass = (process.env.INITIAL_MANAGER_PASSWORD || "").trim();
      const managerUsername = (process.env.INITIAL_MANAGER_USERNAME || "manager").trim();
      const managerPassword = !rawMgrPass || !isProd && rawMgrPass === "CHANGE_ME_MANAGER_PASSWORD" ? isProd ? "" : "Mgammon@1405" : rawMgrPass;
      if (!hasManager) {
        if (isProd && (!managerPassword || FORBIDDEN_DEFAULT_PASSWORDS.has(managerPassword) || managerPassword.length < 8)) {
          throw new Error(
            "SECURITY_CONFIG_ERROR: \u0628\u0631\u0627\u06CC \u0627\u06CC\u062C\u0627\u062F \u062D\u0633\u0627\u0628 \u0627\u0648\u0644\u06CC\u0647 \u0645\u062F\u06CC\u0631 \u062F\u0631 \u0645\u062D\u06CC\u0637 \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC \u0628\u0627\u06CC\u062F \u0645\u062A\u063A\u06CC\u0631 \u0645\u062D\u06CC\u0637\u06CC INITIAL_MANAGER_PASSWORD \u0628\u0627 \u0645\u0642\u062F\u0627\u0631 \u0627\u0645\u0646 \u0648 \u063A\u06CC\u0631\u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u062A\u0646\u0638\u06CC\u0645 \u0634\u0648\u062F."
          );
        }
        const hash = await import_bcryptjs.default.hash(managerPassword, 10);
        await p.execute(
          "INSERT INTO users (username, full_name, role, password_hash, collaboration_start_shamsi, is_active, must_change_password) VALUES (?, ?, ?, ?, ?, 1, 1)",
          [managerUsername, "\u0645\u062C\u06CC\u062F \u0646\u0648\u0631\u0627\u06CC\u06CC", "manager", hash, "1405/06/15"]
        );
      } else {
        await p.execute(
          "UPDATE users SET full_name = '\u0645\u062C\u06CC\u062F \u0646\u0648\u0631\u0627\u06CC\u06CC' WHERE role = 'manager' AND (full_name IS NULL OR full_name = '')"
        );
      }
      const rawWrkPass = (process.env.INITIAL_WORKER_PASSWORD || "").trim();
      const workerUsername = (process.env.INITIAL_WORKER_USERNAME || "worker").trim();
      const workerPassword = !rawWrkPass || !isProd && rawWrkPass === "CHANGE_ME_WORKER_PASSWORD" ? isProd ? "" : "Worker@1405" : rawWrkPass;
      if (!hasWorker) {
        if (isProd && (!workerPassword || FORBIDDEN_DEFAULT_PASSWORDS.has(workerPassword) || workerPassword.length < 8)) {
          throw new Error(
            "SECURITY_CONFIG_ERROR: \u0628\u0631\u0627\u06CC \u0627\u06CC\u062C\u0627\u062F \u062D\u0633\u0627\u0628 \u0627\u0648\u0644\u06CC\u0647 \u067E\u0631\u0633\u0646\u0644 \u062F\u0631 \u0645\u062D\u06CC\u0637 \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC \u0628\u0627\u06CC\u062F \u0645\u062A\u063A\u06CC\u0631 \u0645\u062D\u06CC\u0637\u06CC INITIAL_WORKER_PASSWORD \u0628\u0627 \u0645\u0642\u062F\u0627\u0631 \u0627\u0645\u0646 \u0648 \u063A\u06CC\u0631\u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u062A\u0646\u0638\u06CC\u0645 \u0634\u0648\u062F."
          );
        }
        const hash = await import_bcryptjs.default.hash(workerPassword, 10);
        await p.execute(
          "INSERT INTO users (username, full_name, role, password_hash, collaboration_start_shamsi, is_active, must_change_password) VALUES (?, ?, ?, ?, ?, 1, 1)",
          [workerUsername, "\u0627\u0645\u06CC\u062F \u0645\u06CC\u062B\u0645\u06CC", "worker", hash, "1405/06/15"]
        );
      } else {
        await p.execute(
          "UPDATE users SET full_name = '\u0627\u0645\u06CC\u062F \u0645\u06CC\u062B\u0645\u06CC', collaboration_start_shamsi = COALESCE(NULLIF(collaboration_start_shamsi, ''), '1405/06/15') WHERE role = 'worker' AND (full_name IS NULL OR full_name = '' OR collaboration_start_shamsi IS NULL OR collaboration_start_shamsi = '')"
        );
      }
      const [settingsRows] = await p.execute(
        "SELECT id, banner_bg_url FROM system_settings LIMIT 1"
      );
      if (settingsRows.length === 0) {
        await p.execute(
          `INSERT INTO system_settings (
            shift_start_time,
            shift_end_time,
            thursday_shift_start_time,
            thursday_shift_end_time,
            thursday_overtime_start_time,
            grace_period_minutes,
            break_duration_minutes,
            working_days_json,
            overtime_start_time,
            overtime_before_shift,
            mission_policy,
            friday_holiday_policy,
            official_holidays_json,
            timezone,
            base_salary_toman,
            hourly_rate_toman,
            overtime_calc_mode,
            overtime_percentage,
            overtime_rate_toman,
            collaboration_start_shamsi,
            monthly_leave_quota_days,
            rules_confirmed_by_manager,
            effective_from_shamsi,
            banner_bg_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'PERCENTAGE', 140.00, NULL, '1405/06/15', 2.5, 0, ?, '/assets/media/banner-bg.svg')`,
          [
            "07:00",
            "15:00",
            "07:00",
            "14:00",
            "14:00",
            15,
            30,
            JSON.stringify([6, 0, 1, 2, 3, 4]),
            "15:00",
            0,
            "PAID_AS_WORK",
            "ALL_OVERTIME",
            JSON.stringify([]),
            process.env.APP_TIMEZONE || "Asia/Tehran",
            "1405/06/15"
          ]
        );
      }
      dbInitialized = true;
      lastDbError = null;
    } catch (err) {
      dbInitialized = false;
      lastDbError = sanitizeDbErrorMessage(err);
      throw err;
    } finally {
      dbInitializingPromise = null;
    }
  })();
  return dbInitializingPromise;
}
async function getSystemSettingsFromDb(targetShamsiDate) {
  const p = getPool();
  const [rows] = await p.execute(
    "SELECT * FROM system_settings ORDER BY id ASC LIMIT 1"
  );
  if (rows.length === 0) {
    throw new Error("\u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0633\u0627\u0645\u0627\u0646\u0647 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F");
  }
  const row = rows[0];
  const currentMapped = mapRowToSystemSettings(row);
  if (targetShamsiDate && targetShamsiDate < String(row.effective_from_shamsi)) {
    const [snapRows] = await p.execute(
      `SELECT settings_json FROM system_settings_snapshots
       WHERE effective_from_shamsi <= ?
       ORDER BY effective_from_shamsi DESC, id DESC LIMIT 1`,
      [targetShamsiDate]
    );
    let chosenJson = snapRows.length > 0 ? snapRows[0].settings_json : null;
    if (!chosenJson) {
      const [oldestSnapRows] = await p.execute(
        `SELECT settings_json FROM system_settings_snapshots
         ORDER BY effective_from_shamsi ASC, id ASC LIMIT 1`
      );
      if (oldestSnapRows.length > 0) {
        chosenJson = oldestSnapRows[0].settings_json;
      }
    }
    if (chosenJson) {
      const parsed = typeof chosenJson === "string" ? JSON.parse(chosenJson) : chosenJson;
      const merged = {
        ...currentMapped,
        ...parsed,
        banner_bg_url: currentMapped.banner_bg_url
      };
      if ((merged.base_salary_toman === null || merged.base_salary_toman === void 0 || merged.base_salary_toman <= 0) && (merged.hourly_rate_toman === null || merged.hourly_rate_toman === void 0 || merged.hourly_rate_toman <= 0)) {
        merged.base_salary_toman = currentMapped.base_salary_toman;
        merged.hourly_rate_toman = currentMapped.hourly_rate_toman;
        merged.overtime_calc_mode = currentMapped.overtime_calc_mode;
        merged.overtime_percentage = currentMapped.overtime_percentage;
        merged.overtime_rate_toman = currentMapped.overtime_rate_toman;
      }
      return merged;
    }
  }
  return currentMapped;
}
function mapRowToSystemSettings(row) {
  let workingDays = [6, 0, 1, 2, 3, 4];
  try {
    workingDays = JSON.parse(row.working_days_json || "[6,0,1,2,3,4]");
  } catch {
    workingDays = [6, 0, 1, 2, 3, 4];
  }
  let officialHolidays = [];
  try {
    officialHolidays = JSON.parse(row.official_holidays_json || "[]");
  } catch {
    officialHolidays = [];
  }
  return {
    id: Number(row.id),
    shift_start_time: String(row.shift_start_time || "07:00"),
    shift_end_time: String(row.shift_end_time || "15:00"),
    thursday_shift_start_time: String(row.thursday_shift_start_time || "07:00"),
    thursday_shift_end_time: String(row.thursday_shift_end_time || "14:00"),
    thursday_overtime_start_time: String(row.thursday_overtime_start_time || "14:00"),
    grace_period_minutes: Number(row.grace_period_minutes ?? 15),
    break_duration_minutes: Number(row.break_duration_minutes ?? 30),
    working_days: workingDays,
    overtime_start_time: String(row.overtime_start_time || "15:00"),
    overtime_before_shift: Boolean(row.overtime_before_shift),
    mission_policy: row.mission_policy || "PAID_AS_WORK",
    friday_holiday_policy: row.friday_holiday_policy || "ALL_OVERTIME",
    official_holidays: officialHolidays,
    timezone: String(row.timezone || "Asia/Tehran"),
    base_salary_toman: row.base_salary_toman !== null && row.base_salary_toman !== void 0 ? Number(row.base_salary_toman) : null,
    hourly_rate_toman: row.hourly_rate_toman !== null && row.hourly_rate_toman !== void 0 ? Number(row.hourly_rate_toman) : null,
    overtime_calc_mode: row.overtime_calc_mode || "PERCENTAGE",
    overtime_percentage: row.overtime_percentage !== null && row.overtime_percentage !== void 0 ? Number(row.overtime_percentage) : 140,
    overtime_rate_toman: row.overtime_rate_toman !== null && row.overtime_rate_toman !== void 0 ? Number(row.overtime_rate_toman) : null,
    late_deduction_unit: row.late_deduction_unit === "HOUR" ? "HOUR" : "MINUTE",
    late_deduction_rate_toman: row.late_deduction_rate_toman !== null && row.late_deduction_rate_toman !== void 0 && Number(row.late_deduction_rate_toman) > 0 ? Number(row.late_deduction_rate_toman) : null,
    absence_deduction_unit: row.absence_deduction_unit === "HOUR" ? "HOUR" : "DAY",
    absence_deduction_rate_toman: row.absence_deduction_rate_toman !== null && row.absence_deduction_rate_toman !== void 0 && Number(row.absence_deduction_rate_toman) > 0 ? Number(row.absence_deduction_rate_toman) : null,
    collaboration_start_shamsi: String(row.collaboration_start_shamsi || "1405/06/15"),
    monthly_leave_quota_days: row.monthly_leave_quota_days !== null && row.monthly_leave_quota_days !== void 0 ? Number(row.monthly_leave_quota_days) : 2.5,
    sms_enabled: Boolean(row.sms_enabled),
    sms_on_task_and_message: Boolean(row.sms_on_task_and_message),
    melipayamak_username: String(row.melipayamak_username || ""),
    melipayamak_password: String(row.melipayamak_password || ""),
    melipayamak_from_number: String(row.melipayamak_from_number || ""),
    melipayamak_is_flash: Boolean(row.melipayamak_is_flash),
    worker_phone_number: String(row.worker_phone_number || ""),
    rules_confirmed_by_manager: Boolean(row.rules_confirmed_by_manager),
    effective_from_shamsi: String(row.effective_from_shamsi || "1405/06/15"),
    banner_bg_url: row.banner_bg_url ? String(row.banner_bg_url) : "/assets/media/banner-bg.svg",
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : void 0
  };
}

// src/server/auth.ts
var import_crypto2 = __toESM(require("crypto"), 1);
var SESSION_COOKIE_NAME = "mgammon_duo_sid";
var CSRF_COOKIE_NAME = "mgammon_csrf_token";
var SESSION_DURATION_MS = 1e3 * 60 * 60 * 24 * 7;
function getSessionSecret(env = process.env) {
  validateProductionSecurityConfig(env);
  const raw = (env.SESSION_SECRET || "").trim();
  if (raw && raw !== "undefined" && !FORBIDDEN_DEFAULT_SECRETS.has(raw) && raw.length >= 32) {
    return raw;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SECURITY_CONFIG_ERROR: SESSION_SECRET \u062F\u0631 \u0645\u062D\u06CC\u0637 \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u06CC\u0627 \u0646\u0627\u0627\u0645\u0646 \u0627\u0633\u062A."
    );
  }
  return "mgammon-duo-dev-only-ephemeral-secret-key-2026-local";
}
function hashSessionToken(rawToken) {
  const secret = getSessionSecret();
  return import_crypto2.default.createHmac("sha256", secret).update(rawToken).digest("hex");
}
function generateCsrfToken(rawSessionToken) {
  const secret = getSessionSecret();
  return import_crypto2.default.createHmac("sha256", `${secret}:csrf-protection`).update(rawSessionToken).digest("hex");
}
async function createServerSession(userId, ipAddress, userAgent) {
  const rawToken = import_crypto2.default.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
  const csrfToken = generateCsrfToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const pool2 = getPool();
  await pool2.execute(
    "INSERT INTO user_sessions (token_hash, user_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)",
    [
      tokenHash,
      userId,
      ipAddress ? ipAddress.slice(0, 64) : null,
      userAgent ? userAgent.slice(0, 255) : null,
      expiresAt
    ]
  );
  return { rawToken, csrfToken, expiresAt };
}
function setSessionCookie(res, rawToken, expiresAt) {
  const isSecure = process.env.NODE_ENV === "production" || Boolean(process.env.APP_URL?.startsWith("https://"));
  const csrfToken = generateCsrfToken(rawToken);
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    expires: expiresAt,
    path: "/"
  });
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isSecure,
    sameSite: "lax",
    expires: expiresAt,
    path: "/"
  });
  res.setHeader("X-CSRF-Token", csrfToken);
  return csrfToken;
}
function clearSessionCookie(res) {
  const isSecure = process.env.NODE_ENV === "production" || Boolean(process.env.APP_URL?.startsWith("https://"));
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/"
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: isSecure,
    sameSite: "lax",
    path: "/"
  });
}
var loginAttemptsMap = /* @__PURE__ */ new Map();
var MAX_FAILED_LOGIN_ATTEMPTS = 5;
var LOGIN_WINDOW_MS = 15 * 60 * 1e3;
var LOGIN_LOCKOUT_MS = 15 * 60 * 1e3;
function getLoginAttemptKey(ip, username) {
  return `${ip || "unknown"}:${username.trim().toLowerCase()}`;
}
function checkLoginRateLimit(ip, username) {
  const key = getLoginAttemptKey(ip, username);
  const now = Date.now();
  const entry = loginAttemptsMap.get(key);
  if (!entry) {
    return { allowed: true, retryAfterSeconds: 0, attempts: 0 };
  }
  if (entry.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1e3)),
      attempts: entry.count
    };
  }
  if (now - entry.firstAttemptAt > LOGIN_WINDOW_MS) {
    loginAttemptsMap.delete(key);
    return { allowed: true, retryAfterSeconds: 0, attempts: 0 };
  }
  return { allowed: true, retryAfterSeconds: 0, attempts: entry.count };
}
async function recordFailedLoginAttempt(ip, username) {
  const key = getLoginAttemptKey(ip, username);
  const now = Date.now();
  const existing = loginAttemptsMap.get(key);
  let state;
  if (!existing || now - existing.firstAttemptAt > LOGIN_WINDOW_MS) {
    state = { count: 1, firstAttemptAt: now, lockedUntil: 0 };
  } else {
    state = {
      ...existing,
      count: existing.count + 1
    };
  }
  if (state.count >= MAX_FAILED_LOGIN_ATTEMPTS) {
    state.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }
  loginAttemptsMap.set(key, state);
  const delayMs = Math.min(400, state.count * 75);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return {
    locked: state.lockedUntil > now,
    attempts: state.count,
    retryAfterSeconds: state.lockedUntil > now ? Math.ceil(LOGIN_LOCKOUT_MS / 1e3) : 0
  };
}
function clearLoginAttempts(ip, username) {
  const key = getLoginAttemptKey(ip, username);
  loginAttemptsMap.delete(key);
}
function requireCsrfProtection(req, res, next) {
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method.toUpperCase())) {
    next();
    return;
  }
  const originHeader = req.headers.origin;
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  if (originHeader && hostHeader) {
    try {
      const originUrl = new URL(String(originHeader));
      const allowedHost = String(hostHeader).split(",")[0].trim();
      let appUrlHost = "";
      if (process.env.APP_URL) {
        try {
          appUrlHost = new URL(process.env.APP_URL).host;
        } catch {
          appUrlHost = "";
        }
      }
      if (originUrl.host !== allowedHost && (!appUrlHost || originUrl.host !== appUrlHost)) {
        res.status(403).json({
          ok: false,
          code: "CSRF_ORIGIN_MISMATCH",
          message: "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0627\u0632 \u0645\u0628\u062F\u0623 \u063A\u06CC\u0631\u0645\u062C\u0627\u0632 (Origin \u0646\u0627\u0645\u0639\u062A\u0628\u0631) \u0645\u0633\u062F\u0648\u062F \u0634\u062F."
        });
        return;
      }
    } catch {
      res.status(403).json({
        ok: false,
        code: "CSRF_ORIGIN_INVALID",
        message: "\u0647\u062F\u0631 Origin \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A."
      });
      return;
    }
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  const hasBearerHeader = Boolean(req.headers.authorization?.startsWith("Bearer "));
  const publicAuthPaths = ["/auth/login", "/auth/biometric/login"];
  if (cookieToken && !hasBearerHeader && !publicAuthPaths.includes(req.path)) {
    const clientCsrf = String(req.headers["x-csrf-token"] || "").trim();
    const expectedCsrf = generateCsrfToken(String(cookieToken));
    if (!clientCsrf || clientCsrf.length !== expectedCsrf.length || !import_crypto2.default.timingSafeEqual(Buffer.from(clientCsrf), Buffer.from(expectedCsrf))) {
      res.status(403).json({
        ok: false,
        code: "CSRF_TOKEN_INVALID",
        message: "\u062A\u0648\u06A9\u0646 \u0627\u0645\u0646\u06CC\u062A\u06CC CSRF \u0627\u0631\u0633\u0627\u0644 \u0646\u0634\u062F\u0647 \u06CC\u0627 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A."
      });
      return;
    }
  }
  next();
}
async function getSessionUser(req) {
  const bearerToken = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : null;
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] ? String(req.cookies[SESSION_COOKIE_NAME]).trim() : null;
  const queryToken = req.method === "GET" && typeof req.query?.token === "string" ? req.query.token.trim() : null;
  const candidateTokens = Array.from(
    new Set(
      [bearerToken, cookieToken, queryToken].filter(
        (t) => Boolean(t && typeof t === "string" && t.length >= 32)
      )
    )
  );
  if (candidateTokens.length === 0) {
    return null;
  }
  const pool2 = getPool();
  for (const rawToken of candidateTokens) {
    const tokenHash = hashSessionToken(rawToken);
    const [rows] = await pool2.execute(
      `SELECT u.id, u.username, u.full_name, u.role, u.avatar_url, u.collaboration_start_shamsi, u.phone_number, u.biometric_token_hash, u.must_change_password, u.is_active, u.last_login_at, s.expires_at
       FROM user_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );
    if (rows.length === 0) {
      continue;
    }
    const row = rows[0];
    if (!row.is_active) {
      await pool2.execute("DELETE FROM user_sessions WHERE user_id = ?", [row.id]);
      continue;
    }
    const expiresAt = new Date(row.expires_at);
    if (expiresAt.getTime() < Date.now()) {
      await pool2.execute("DELETE FROM user_sessions WHERE token_hash = ?", [tokenHash]);
      continue;
    }
    return {
      rawToken,
      tokenHash,
      user: {
        id: Number(row.id),
        username: String(row.username),
        full_name: String(row.full_name),
        role: row.role,
        avatar_url: row.avatar_url ? String(row.avatar_url) : null,
        collaboration_start_shamsi: row.collaboration_start_shamsi ? String(row.collaboration_start_shamsi) : "1405/06/15",
        phone_number: row.phone_number ? String(row.phone_number) : null,
        biometric_enabled: Boolean(row.biometric_token_hash),
        must_change_password: Boolean(row.must_change_password),
        last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null
      }
    };
  }
  return null;
}
async function requireAuth(req, res, next) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      res.status(401).json({
        ok: false,
        code: "UNAUTHORIZED",
        message: "\u0646\u0634\u0633\u062A \u06A9\u0627\u0631\u0628\u0631\u06CC \u0634\u0645\u0627 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u06CC\u0627 \u0648\u0627\u0631\u062F \u062D\u0633\u0627\u0628 \u0646\u0634\u062F\u0647\u200C\u0627\u06CC\u062F."
      });
      return;
    }
    const enforceInitialPassChange = process.env.NODE_ENV === "production" || process.env.ENFORCE_PASSWORD_CHANGE === "true" || req.headers["x-enforce-password-change"] === "1";
    const allowedDuringPassChange = ["/auth/change-password", "/auth/logout", "/auth/me"];
    if (enforceInitialPassChange && session.user.must_change_password && !allowedDuringPassChange.includes(req.path)) {
      res.status(403).json({
        ok: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "\u0628\u0647 \u062F\u0644\u0627\u06CC\u0644 \u0627\u0645\u0646\u06CC\u062A\u06CC\u060C \u067E\u06CC\u0634 \u0627\u0632 \u0627\u062F\u0627\u0645\u0647 \u06A9\u0627\u0631 \u0628\u0627\u06CC\u062F \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0648\u0644\u06CC\u0647 \u062E\u0648\u062F \u0631\u0627 \u062A\u063A\u06CC\u06CC\u0631 \u062F\u0647\u06CC\u062F."
      });
      return;
    }
    req.user = session.user;
    req.sessionTokenHash = session.tokenHash;
    req.rawSessionToken = session.rawToken;
    next();
  } catch (err) {
    handleServerError(res, err);
  }
}
function requireRole(allowedRole) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        const session = await getSessionUser(req);
        if (!session) {
          res.status(401).json({
            ok: false,
            code: "UNAUTHORIZED",
            message: "\u0644\u0637\u0641\u0627\u064B \u0627\u0628\u062A\u062F\u0627 \u0648\u0627\u0631\u062F \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0634\u0648\u06CC\u062F."
          });
          return;
        }
        req.user = session.user;
        req.sessionTokenHash = session.tokenHash;
        req.rawSessionToken = session.rawToken;
      }
      if (req.user.role !== allowedRole) {
        res.status(403).json({
          ok: false,
          code: "FORBIDDEN",
          message: "\u0634\u0645\u0627 \u0645\u062C\u0648\u0632 \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u0647 \u0627\u06CC\u0646 \u0628\u062E\u0634 \u06CC\u0627 \u0627\u0646\u062C\u0627\u0645 \u0627\u06CC\u0646 \u0639\u0645\u0644\u06CC\u0627\u062A \u0631\u0627 \u0646\u062F\u0627\u0631\u06CC\u062F."
        });
        return;
      }
      next();
    } catch (err) {
      handleServerError(res, err);
    }
  };
}
async function recordAuditLog(params) {
  const executor = params.connection || getPool();
  await executor.execute(
    `INSERT INTO audit_logs
      (actor_user_id, action_type, target_entity, target_id, before_state, after_state, reason, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.actorUserId,
      params.actionType,
      params.targetEntity,
      params.targetId ?? null,
      params.beforeState !== void 0 ? JSON.stringify(params.beforeState) : null,
      params.afterState !== void 0 ? JSON.stringify(params.afterState) : null,
      params.reason ?? null,
      params.ipAddress ? params.ipAddress.slice(0, 64) : null
    ]
  );
}
function handleServerError(res, err) {
  const errObj = err;
  if (errObj?.statusCode && errObj.statusCode >= 400 && errObj.statusCode < 500) {
    res.status(errObj.statusCode).json({
      ok: false,
      code: errObj.code || "VALIDATION_ERROR",
      message: errObj.message || "\u0648\u0631\u0648\u062F\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A."
    });
    return;
  }
  const dbErrorCodes = [
    "ECONNREFUSED",
    "PROTOCOL_CONNECTION_LOST",
    "ER_ACCESS_DENIED_ERROR",
    "ER_BAD_DB_ERROR",
    "ETIMEDOUT",
    "ENOTFOUND"
  ];
  if (errObj?.code && dbErrorCodes.includes(errObj.code) || errObj?.message === "DATABASE_CONNECTION_LOST" || errObj?.message === "SIMULATED_DB_DISCONNECT") {
    res.status(503).json({
      ok: false,
      code: "DB_UNAVAILABLE",
      message: "\u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u0633\u0631\u0648\u0631 \u0628\u0631\u0642\u0631\u0627\u0631 \u0646\u06CC\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0627\u062A\u0635\u0627\u0644 \u0631\u0627 \u0628\u0631\u0631\u0633\u06CC \u06A9\u0646\u06CC\u062F."
    });
    return;
  }
  const safeMsg = (errObj?.message || "Unknown error").replace(
    /(password|token|secret|authorization)=[^\s&]+/gi,
    "$1=[REDACTED]"
  );
  console.error("[MGAMMON Server Error]:", safeMsg);
  res.status(500).json({
    ok: false,
    code: "INTERNAL_ERROR",
    message: "\u062E\u0637\u0627\u06CC\u06CC \u062F\u0631 \u067E\u0631\u062F\u0627\u0632\u0634 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0631\u062E \u062F\u0627\u062F. \u0644\u0637\u0641\u0627\u064B \u0645\u062C\u062F\u062F\u0627\u064B \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F."
  });
}

// src/server/routes.ts
var import_express = require("express");
var import_bcryptjs2 = __toESM(require("bcryptjs"), 1);
var import_crypto4 = __toESM(require("crypto"), 1);
var import_fs3 = __toESM(require("fs"), 1);
var import_path3 = __toESM(require("path"), 1);
var XLSX = __toESM(require("xlsx"), 1);

// src/server/backup.ts
var import_crypto3 = __toESM(require("crypto"), 1);
var import_fs2 = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
var BACKUP_TABLES_ORDERED = [
  "schema_migrations",
  "users",
  "user_sessions",
  "system_settings",
  "system_settings_snapshots",
  "attendance_logs",
  "historical_work_records",
  "daily_work_reports",
  "financial_transactions",
  "work_correspondences",
  "leave_requests",
  "work_tasks",
  "audit_logs"
];
var PRIVATE_MEDIA_SUBFOLDERS = [
  "avatars",
  "attachments",
  "excel",
  "audio",
  "receipts",
  "reports"
];
function computeSha256(content) {
  return import_crypto3.default.createHash("sha256").update(content).digest("hex");
}
function escapeSqlValue(val) {
  if (val === null || val === void 0) return "NULL";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "0";
  if (typeof val === "boolean") return val ? "1" : "0";
  if (val instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `'${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())} ${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}'`;
  }
  if (typeof val === "object") {
    const jsonStr = JSON.stringify(val).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    return `'${jsonStr}'`;
  }
  const str = String(val).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return `'${str}'`;
}
async function collectDatabaseMetrics(customPool) {
  const p = customPool || getPool();
  const tableCounts = {};
  for (const tbl of BACKUP_TABLES_ORDERED) {
    const [rows] = await p.query(
      `SELECT COUNT(*) AS cnt FROM \`${tbl}\``
    );
    tableCounts[tbl] = Number(rows[0]?.cnt || 0);
  }
  const [finRows] = await p.query(`
    SELECT
      COUNT(*) AS total_cnt,
      COALESCE(SUM(amount_toman), 0) AS total_amount,
      COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_amount,
      COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_amount,
      COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN amount_toman ELSE 0 END), 0) AS rejected_amount
    FROM financial_transactions
  `);
  const [histRows] = await p.query(`
    SELECT
      COALESCE(SUM(net_work_minutes), 0) AS total_net_mins,
      COALESCE(SUM(overtime_minutes), 0) AS total_ot_mins
    FROM historical_work_records
    WHERE status = 'APPROVED'
  `);
  const [attRows] = await p.query(`
    SELECT COUNT(*) AS active_cnt
    FROM attendance_logs
    WHERE is_deleted = 0
  `);
  return {
    tableCounts,
    financialSums: {
      totalTransactionsCount: Number(finRows[0]?.total_cnt || 0),
      totalAmountToman: Number(finRows[0]?.total_amount || 0),
      approvedAmountToman: Number(finRows[0]?.approved_amount || 0),
      pendingAmountToman: Number(finRows[0]?.pending_amount || 0),
      rejectedAmountToman: Number(finRows[0]?.rejected_amount || 0),
      totalHistoricalNetWorkMinutes: Number(histRows[0]?.total_net_mins || 0),
      totalHistoricalOvertimeMinutes: Number(histRows[0]?.total_ot_mins || 0),
      activeAttendanceLogsCount: Number(attRows[0]?.active_cnt || 0)
    }
  };
}
async function createFullBackup(options) {
  const p = options?.customPool || getPool();
  const cfg = getDbConfig();
  const backupDir = options?.backupDir || process.env.BACKUP_DIR || import_path2.default.resolve(process.cwd(), ".data/backups");
  const privateMediaDir = options?.privateMediaDir || import_path2.default.resolve(process.cwd(), ".data/private_media");
  import_fs2.default.mkdirSync(backupDir, { recursive: true, mode: 448 });
  const metrics = await collectDatabaseMetrics(p);
  if ((metrics.tableCounts.users || 0) === 0 || (metrics.tableCounts.system_settings || 0) === 0) {
    throw new Error(
      "BACKUP_EMPTY_DB_ERROR: \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0641\u0627\u0642\u062F \u06A9\u0627\u0631\u0628\u0631\u0627\u0646 \u06CC\u0627 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u067E\u0627\u06CC\u0647 \u0627\u0633\u062A\u061B \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u200C\u06AF\u06CC\u0631\u06CC \u0627\u0632 \u0648\u0636\u0639\u06CC\u062A \u0646\u0627\u0642\u0635 \u0645\u062A\u0648\u0642\u0641 \u0634\u062F."
    );
  }
  const tables = {};
  const sqlLines = [
    "-- MGAMMON Duo Verified SQL Backup",
    `-- Database: ${cfg.database}`,
    `-- Created At: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    "SET NAMES utf8mb4;",
    "SET time_zone = '+03:30';",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "START TRANSACTION;",
    ""
  ];
  for (const tbl of BACKUP_TABLES_ORDERED) {
    const [rows] = await p.query(`SELECT * FROM \`${tbl}\``);
    const plainRows = rows.map((r) => ({ ...r }));
    tables[tbl] = plainRows;
    sqlLines.push(`-- Table: ${tbl} (${plainRows.length} rows)`);
    sqlLines.push(`DELETE FROM \`${tbl}\`;`);
    for (const row of plainRows) {
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      const colList = cols.map((c) => `\`${c}\``).join(", ");
      const valList = cols.map((c) => escapeSqlValue(row[c])).join(", ");
      sqlLines.push(`INSERT INTO \`${tbl}\` (${colList}) VALUES (${valList});`);
    }
    sqlLines.push("");
  }
  sqlLines.push("COMMIT;");
  sqlLines.push("SET FOREIGN_KEY_CHECKS = 1;");
  const sqlDump = sqlLines.join("\n");
  const mediaFiles = [];
  let mediaTotalBytes = 0;
  if (import_fs2.default.existsSync(privateMediaDir)) {
    for (const folder of PRIVATE_MEDIA_SUBFOLDERS) {
      const folderPath = import_path2.default.join(privateMediaDir, folder);
      if (!import_fs2.default.existsSync(folderPath)) continue;
      const entries = import_fs2.default.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = import_path2.default.join(folderPath, entry.name);
        const buf = import_fs2.default.readFileSync(fullPath);
        if (buf.length === 0) continue;
        const sha256 = computeSha256(buf);
        mediaFiles.push({
          folder,
          fileName: entry.name,
          relativePath: `${folder}/${entry.name}`,
          sizeBytes: buf.length,
          sha256,
          base64Data: buf.toString("base64")
        });
        mediaTotalBytes += buf.length;
      }
    }
  }
  const payloadString = JSON.stringify({ tables, mediaFiles, sqlDump });
  const payloadChecksum = computeSha256(payloadString);
  const now = /* @__PURE__ */ new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const backupId = `mgbackup_${cfg.database}_${timestamp}_${import_crypto3.default.randomBytes(3).toString("hex")}`;
  const manifest = {
    backupId,
    formatVersion: 1,
    createdAt: now.toISOString(),
    database: cfg.database,
    tableCounts: metrics.tableCounts,
    financialSums: metrics.financialSums,
    mediaFilesCount: mediaFiles.length,
    mediaTotalBytes,
    payloadChecksum
  };
  const archiveBundle = {
    manifest,
    tables,
    mediaFiles,
    sqlDump
  };
  const backupFilePath = import_path2.default.join(backupDir, `${backupId}.mgbackup.json`);
  const tmpFilePath = `${backupFilePath}.tmp`;
  const sqlDumpFilePath = import_path2.default.join(backupDir, `${backupId}.sql`);
  const serializedArchive = JSON.stringify(archiveBundle, null, 2);
  import_fs2.default.writeFileSync(tmpFilePath, serializedArchive, { mode: 384 });
  const verification = verifyBackupArchive(tmpFilePath);
  if (!verification.valid) {
    try {
      import_fs2.default.unlinkSync(tmpFilePath);
    } catch {
    }
    throw new Error(
      `BACKUP_VERIFICATION_FAILED: \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u200C\u06AF\u06CC\u0631\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F (${verification.reason})`
    );
  }
  import_fs2.default.renameSync(tmpFilePath, backupFilePath);
  import_fs2.default.writeFileSync(sqlDumpFilePath, sqlDump, { mode: 384 });
  const maxRetained = options?.maxRetainedBackups ?? 30;
  if (maxRetained > 0) {
    pruneOldBackups(backupDir, maxRetained);
  }
  const stat = import_fs2.default.statSync(backupFilePath);
  return {
    backupFilePath,
    sqlDumpFilePath,
    manifest,
    sizeBytes: stat.size
  };
}
function verifyBackupArchive(backupFilePath) {
  try {
    if (!import_fs2.default.existsSync(backupFilePath)) {
      return { valid: false, reason: "\u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." };
    }
    const stat = import_fs2.default.statSync(backupFilePath);
    if (!stat.isFile() || stat.size < 128) {
      return { valid: false, reason: "\u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u062E\u0627\u0644\u06CC \u06CC\u0627 \u0646\u0627\u0642\u0635 \u0627\u0633\u062A." };
    }
    const rawText = import_fs2.default.readFileSync(backupFilePath, "utf8");
    if (!rawText || !rawText.trim().startsWith("{") || !rawText.trim().endsWith("}")) {
      return { valid: false, reason: "\u0645\u062D\u062A\u0648\u0627\u06CC \u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0646\u0627\u0642\u0635 \u06CC\u0627 \u0628\u0631\u06CC\u062F\u0647\u200C\u0634\u062F\u0647 (Truncated) \u0627\u0633\u062A." };
    }
    const parsed = JSON.parse(rawText);
    if (!parsed.manifest || !parsed.tables || !Array.isArray(parsed.mediaFiles) || typeof parsed.sqlDump !== "string") {
      return { valid: false, reason: "\u0633\u0627\u062E\u062A\u0627\u0631 \u062F\u0627\u062E\u0644\u06CC \u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0641\u0627\u0642\u062F \u0628\u062E\u0634\u200C\u0647\u0627\u06CC \u0627\u062C\u0628\u0627\u0631\u06CC \u0627\u0633\u062A." };
    }
    const { manifest, tables, mediaFiles, sqlDump } = parsed;
    if (!manifest.payloadChecksum || !manifest.tableCounts || !manifest.financialSums) {
      return { valid: false, reason: "\u0645\u062A\u0627\u062F\u06CC\u062A\u0627\u06CC \u0645\u0627\u0646\u06CC\u0641\u0633\u062A \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0646\u0627\u0642\u0635 \u0627\u0633\u062A." };
    }
    for (const tbl of BACKUP_TABLES_ORDERED) {
      if (!Array.isArray(tables[tbl])) {
        return { valid: false, reason: `\u062C\u062F\u0648\u0644 \u0627\u062C\u0628\u0627\u0631\u06CC ${tbl} \u062F\u0631 \u0646\u0633\u062E\u0647 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0648\u062C\u0648\u062F \u0646\u062F\u0627\u0631\u062F.` };
      }
      if (tables[tbl].length !== manifest.tableCounts[tbl]) {
        return {
          valid: false,
          reason: `\u062A\u0639\u062F\u0627\u062F \u0631\u06A9\u0648\u0631\u062F\u0647\u0627\u06CC \u062C\u062F\u0648\u0644 ${tbl} (${tables[tbl].length}) \u0628\u0627 \u0645\u0627\u0646\u06CC\u0641\u0633\u062A (${manifest.tableCounts[tbl]}) \u0647\u0645\u062E\u0648\u0627\u0646\u06CC \u0646\u062F\u0627\u0631\u062F.`
        };
      }
    }
    const activeFinRows = (tables.financial_transactions || []).filter(
      (r) => r.deleted_at === null || r.deleted_at === void 0
    );
    const actualTotalAmount = activeFinRows.reduce(
      (acc, r) => acc + Number(r.amount_toman || 0),
      0
    );
    if (actualTotalAmount !== Number(manifest.financialSums.totalAmountToman || 0)) {
      return {
        valid: false,
        reason: `\u062C\u0645\u0639 \u0645\u0628\u0627\u0644\u063A \u0645\u0627\u0644\u06CC \u062F\u0631 \u0631\u06A9\u0648\u0631\u062F\u0647\u0627 (${actualTotalAmount}) \u0628\u0627 \u0645\u0627\u0646\u06CC\u0641\u0633\u062A (${manifest.financialSums.totalAmountToman}) \u0645\u0637\u0627\u0628\u0642\u062A \u0646\u062F\u0627\u0631\u062F.`
      };
    }
    if ((tables.users?.length || 0) === 0 || (tables.system_settings?.length || 0) === 0) {
      return {
        valid: false,
        reason: "\u0646\u0633\u062E\u0647 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0641\u0627\u0642\u062F \u06A9\u0627\u0631\u0628\u0631\u0627\u0646 \u06CC\u0627 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0633\u0627\u0645\u0627\u0646\u0647 \u0627\u0633\u062A."
      };
    }
    const expectedChecksum = computeSha256(JSON.stringify({ tables, mediaFiles, sqlDump }));
    if (expectedChecksum !== manifest.payloadChecksum) {
      return {
        valid: false,
        reason: "\u0639\u062F\u0645 \u062A\u0637\u0627\u0628\u0642 \u0627\u0645\u0636\u0627\u06CC \u062F\u06CC\u062C\u06CC\u062A\u0627\u0644 (SHA-256 Checksum)\u061B \u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u062E\u0631\u0627\u0628 \u06CC\u0627 \u062F\u0633\u062A\u06A9\u0627\u0631\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A."
      };
    }
    for (const mf of mediaFiles) {
      const buf = Buffer.from(mf.base64Data || "", "base64");
      if (buf.length !== mf.sizeBytes || computeSha256(buf) !== mf.sha256) {
        return {
          valid: false,
          reason: `\u0641\u0627\u06CC\u0644 \u067E\u06CC\u0648\u0633\u062A ${mf.relativePath} \u062F\u0631 \u0628\u0633\u062A\u0647 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u062E\u0631\u0627\u0628 \u0634\u062F\u0647 \u0627\u0633\u062A.`
        };
      }
    }
    return {
      valid: true,
      manifest
    };
  } catch (err) {
    return {
      valid: false,
      reason: `\u062E\u0637\u0627 \u062F\u0631 \u062E\u0648\u0627\u0646\u062F\u0646 \u06CC\u0627 \u0627\u0639\u062A\u0628\u0627\u0631\u0633\u0646\u062C\u06CC \u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646: ${err.message}`
    };
  }
}
function listAvailableBackups(customBackupDir) {
  const backupDir = customBackupDir || process.env.BACKUP_DIR || import_path2.default.resolve(process.cwd(), ".data/backups");
  if (!import_fs2.default.existsSync(backupDir)) {
    return [];
  }
  const entries = import_fs2.default.readdirSync(backupDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".mgbackup.json")).sort((a, b) => b.name.localeCompare(a.name));
  return entries.map((e) => {
    const fullPath = import_path2.default.join(backupDir, e.name);
    const stat = import_fs2.default.statSync(fullPath);
    const check = verifyBackupArchive(fullPath);
    return {
      fileName: e.name,
      filePath: fullPath,
      sizeBytes: stat.size,
      valid: check.valid,
      manifest: check.manifest,
      error: check.reason
    };
  });
}
function pruneOldBackups(backupDir, maxRetained) {
  try {
    const files = import_fs2.default.readdirSync(backupDir).filter((f) => f.endsWith(".mgbackup.json")).sort((a, b) => b.localeCompare(a));
    if (files.length <= maxRetained) return;
    const toRemove = files.slice(maxRetained);
    for (const f of toRemove) {
      const fullJson = import_path2.default.join(backupDir, f);
      const fullSql = fullJson.replace(/\.mgbackup\.json$/, ".sql");
      try {
        if (import_fs2.default.existsSync(fullJson)) import_fs2.default.unlinkSync(fullJson);
        if (import_fs2.default.existsSync(fullSql)) import_fs2.default.unlinkSync(fullSql);
      } catch {
      }
    }
  } catch {
  }
}

// src/shared/jalali.ts
var jalaali = __toESM(require("jalaali-js"), 1);
var PERSIAN_DIGITS = ["\u06F0", "\u06F1", "\u06F2", "\u06F3", "\u06F4", "\u06F5", "\u06F6", "\u06F7", "\u06F8", "\u06F9"];
var PERSIAN_WEEKDAYS = {
  6: "\u0634\u0646\u0628\u0647",
  0: "\u06CC\u06A9\u0634\u0646\u0628\u0647",
  1: "\u062F\u0648\u0634\u0646\u0628\u0647",
  2: "\u0633\u0647\u200C\u0634\u0646\u0628\u0647",
  3: "\u0686\u0647\u0627\u0631\u0634\u0646\u0628\u0647",
  4: "\u067E\u0646\u062C\u0634\u0646\u0628\u0647",
  5: "\u062C\u0645\u0639\u0647"
};
function toPersianDigits(input) {
  if (input === null || input === void 0) return "";
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}
function toEnglishDigits(input) {
  if (!input) return "";
  return input.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d)));
}
function pad2(num) {
  return String(num).padStart(2, "0");
}
function gregorianToShamsi(gregorianDateStr) {
  const clean = toEnglishDigits(gregorianDateStr).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  if (!match) {
    throw new Error(`\u0641\u0631\u0645\u062A \u062A\u0627\u0631\u06CC\u062E \u0645\u06CC\u0644\u0627\u062F\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A: ${gregorianDateStr}`);
  }
  const gy = Number(match[1]);
  const gm = Number(match[2]);
  const gd = Number(match[3]);
  const { jy, jm, jd } = jalaali.toJalaali(gy, gm, gd);
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}
function shamsiToGregorian(shamsiDateStr) {
  const clean = toEnglishDigits(shamsiDateStr).trim().replace(/-/g, "/");
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(clean);
  if (!match) {
    throw new Error(`\u0641\u0631\u0645\u062A \u062A\u0627\u0631\u06CC\u062E \u0634\u0645\u0633\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A: ${shamsiDateStr}`);
  }
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) {
    throw new Error(`\u062A\u0627\u0631\u06CC\u062E \u0634\u0645\u0633\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A: ${shamsiDateStr}`);
  }
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}
function isValidShamsiDate(shamsiDateStr) {
  try {
    const clean = toEnglishDigits(shamsiDateStr).trim().replace(/-/g, "/");
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(clean);
    if (!match) return false;
    return jalaali.isValidJalaaliDate(Number(match[1]), Number(match[2]), Number(match[3]));
  } catch {
    return false;
  }
}
function normalizeShamsiDate(shamsiDateStr) {
  const clean = toEnglishDigits(shamsiDateStr).trim().replace(/-/g, "/");
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(clean);
  if (!match) throw new Error("\u062A\u0627\u0631\u06CC\u062E \u0634\u0645\u0633\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A");
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) {
    throw new Error("\u062A\u0627\u0631\u06CC\u062E \u0634\u0645\u0633\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A");
  }
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}
function getNowInTimezone(timezone = "Asia/Tehran", referenceDate = /* @__PURE__ */ new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(referenceDate);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  const workDate = `${map.year}-${map.month}-${map.day}`;
  const shamsiDate = gregorianToShamsi(workDate);
  const timeHHMMSS = `${hour}:${map.minute}:${map.second}`;
  const timeHHMM = `${hour}:${map.minute}`;
  const [y, m, d] = workDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = utcDate.getUTCDay();
  return {
    workDate,
    shamsiDate,
    timeHHMMSS,
    timeHHMM,
    dayOfWeek,
    dayNamePersian: PERSIAN_WEEKDAYS[dayOfWeek] || ""
  };
}
function getDayOfWeekFromGregorian(workDate) {
  const [y, m, d] = workDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.getUTCDay();
}
function getPersianDayName(workDate) {
  const dow = getDayOfWeekFromGregorian(workDate);
  return PERSIAN_WEEKDAYS[dow] || "";
}
function getShamsiDayOfWeekName(shamsiDate) {
  try {
    const greg = shamsiToGregorian(shamsiDate);
    return getPersianDayName(greg);
  } catch {
    return "";
  }
}
function isValidTimeHHMMOrHHMMSS(timeStr, allowSeconds = true) {
  if (!timeStr) return false;
  const clean = toEnglishDigits(String(timeStr)).trim();
  const regex = allowSeconds ? /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/ : /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return regex.test(clean);
}
function parseTimeToMinutes(timeStr) {
  const clean = toEnglishDigits(String(timeStr || "08:00")).trim();
  const parts = clean.split(":").map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
    return 8 * 60;
  }
  return parts[0] * 60 + parts[1];
}
function formatMinutesToDurationPersian(totalMinutes) {
  const safe = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) {
    return `${toPersianDigits(mins)} \u062F\u0642\u06CC\u0642\u0647`;
  }
  if (mins === 0) {
    return `${toPersianDigits(hours)} \u0633\u0627\u0639\u062A`;
  }
  return `${toPersianDigits(hours)} \u0633\u0627\u0639\u062A \u0648 ${toPersianDigits(mins)} \u062F\u0642\u06CC\u0642\u0647`;
}
var formatDurationPersian = formatMinutesToDurationPersian;

// src/shared/calculationEngine.ts
function normalizeTimeHHMMSS(raw) {
  const clean = toEnglishDigits(String(raw || "")).trim();
  const parts = clean.split(":");
  if (parts.length === 2) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:00`;
  }
  if (parts.length >= 3) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:${parts[2].padStart(2, "0")}`;
  }
  return clean;
}
function getAllowedNextEvents(todayActiveLogs) {
  const sorted = [...todayActiveLogs].filter((l) => !l.is_deleted).sort(
    (a, b) => normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) || a.id - b.id
  );
  if (sorted.length === 0) {
    return ["WORK_START", "MISSION_START"];
  }
  const lastEvent = sorted[sorted.length - 1].event_type;
  switch (lastEvent) {
    case "WORK_START":
      return ["MISSION_START", "WORK_END"];
    case "MISSION_START":
      return ["MISSION_END", "WORK_END"];
    case "MISSION_END":
      return ["MISSION_START", "WORK_END"];
    case "WORK_END":
      return ["WORK_START", "MISSION_START"];
    default:
      return ["WORK_START", "MISSION_START"];
  }
}
function validateAttendanceSequence(existingLogs, newEventType, newEventTimeHHMMSS) {
  if (!isValidTimeHHMMOrHHMMSS(newEventTimeHHMMSS, true)) {
    return {
      valid: false,
      error: `\u0641\u0631\u0645\u062A \u0633\u0627\u0639\u062A \u0648\u0627\u0631\u062F\u0634\u062F\u0647 (${newEventTimeHHMMSS}) \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A.`
    };
  }
  const normNewTime = normalizeTimeHHMMSS(newEventTimeHHMMSS);
  const active = [...existingLogs].filter((l) => !l.is_deleted).sort(
    (a, b) => normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) || a.id - b.id
  );
  if (active.length > 0) {
    const last = active[active.length - 1];
    const lastNormTime = normalizeTimeHHMMSS(last.recorded_time);
    if (normNewTime < lastNormTime) {
      return {
        valid: false,
        error: `\u0633\u0627\u0639\u062A \u062B\u0628\u062A \u062C\u062F\u06CC\u062F (${newEventTimeHHMMSS}) \u0646\u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u062F \u0642\u0628\u0644 \u0627\u0632 \u0622\u062E\u0631\u06CC\u0646 \u0639\u0645\u0644\u06CC\u0627\u062A \u062B\u0628\u062A\u200C\u0634\u062F\u0647 (${last.recorded_time}) \u0628\u0627\u0634\u062F.`
      };
    }
    if (normNewTime === lastNormTime && newEventType === last.event_type) {
      return {
        valid: false,
        error: "\u062B\u0628\u062A \u0639\u0645\u0644\u06CC\u0627\u062A \u062A\u06A9\u0631\u0627\u0631\u06CC \u062F\u0631 \u06CC\u06A9 \u0632\u0645\u0627\u0646 \u06CC\u06A9\u0633\u0627\u0646 \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A."
      };
    }
  }
  const allowed = getAllowedNextEvents(active);
  if (!allowed.includes(newEventType)) {
    const labels = {
      WORK_START: "\u0634\u0631\u0648\u0639 \u06A9\u0627\u0631",
      MISSION_START: "\u0634\u0631\u0648\u0639 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A",
      MISSION_END: "\u067E\u0627\u06CC\u0627\u0646 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A \u0648 \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u062D\u0644 \u06A9\u0627\u0631",
      WORK_END: "\u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631"
    };
    const lastLabel = active.length > 0 ? labels[active[active.length - 1].event_type] : "\u0639\u062F\u0645 \u062B\u0628\u062A \u0648\u0631\u0648\u062F";
    return {
      valid: false,
      error: `\u062B\u0628\u062A \xAB${labels[newEventType]}\xBB \u062F\u0631 \u0648\u0636\u0639\u06CC\u062A \u0641\u0639\u0644\u06CC (${lastLabel}) \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A.`
    };
  }
  return { valid: true };
}
function validateFullDayLogSequence(logs) {
  for (const l of logs) {
    if (!isValidTimeHHMMOrHHMMSS(l.recorded_time, true)) {
      return {
        valid: false,
        error: `\u0641\u0631\u0645\u062A \u0633\u0627\u0639\u062A (${l.recorded_time}) \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A. \u0633\u0627\u0639\u062A \u0628\u0627\u06CC\u062F \u0628\u06CC\u0646 00:00 \u062A\u0627 23:59 \u0628\u0627\u0634\u062F.`
      };
    }
  }
  const sorted = [...logs].sort(
    (a, b) => normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) || (a.id ?? 0) - (b.id ?? 0)
  );
  let state = "IDLE";
  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    const evTime = normalizeTimeHHMMSS(ev.recorded_time);
    const prevTime = i > 0 ? normalizeTimeHHMMSS(sorted[i - 1].recorded_time) : "";
    if (i > 0 && evTime === prevTime && ev.event_type === sorted[i - 1].event_type) {
      return { valid: false, error: "\u062B\u0628\u062A \u0639\u0645\u0644\u06CC\u0627\u062A \u062A\u06A9\u0631\u0627\u0631\u06CC \u062F\u0631 \u06CC\u06A9 \u0632\u0645\u0627\u0646 \u06CC\u06A9\u0633\u0627\u0646 \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A." };
    }
    if (state === "IDLE") {
      if (ev.event_type === "WORK_START") {
        state = "WORKING";
      } else if (ev.event_type === "MISSION_START") {
        state = "MISSION";
      } else {
        return {
          valid: false,
          error: "\u0647\u0631 \u0646\u0648\u0628\u062A \u06A9\u0627\u0631\u06CC \u0628\u0627\u06CC\u062F \u0628\u0627 \xAB\u0634\u0631\u0648\u0639 \u06A9\u0627\u0631\xBB \u06CC\u0627 \xAB\u0634\u0631\u0648\u0639 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A\xBB \u0622\u063A\u0627\u0632 \u0634\u0648\u062F."
        };
      }
    } else if (state === "WORKING") {
      if (ev.event_type === "WORK_START") {
        return { valid: false, error: "\u062B\u0628\u062A \xAB\u0634\u0631\u0648\u0639 \u06A9\u0627\u0631\xBB \u062A\u06A9\u0631\u0627\u0631\u06CC \u067E\u06CC\u0634 \u0627\u0632 \u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631 \u0642\u0628\u0644\u06CC \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A." };
      }
      if (ev.event_type === "MISSION_END") {
        return { valid: false, error: "\u062B\u0628\u062A \xAB\u067E\u0627\u06CC\u0627\u0646 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A\xBB \u0628\u062F\u0648\u0646 \u0634\u0631\u0648\u0639 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A." };
      }
      if (ev.event_type === "MISSION_START") {
        state = "MISSION";
      } else if (ev.event_type === "WORK_END") {
        state = "IDLE";
      }
    } else if (state === "MISSION") {
      if (ev.event_type === "WORK_START" || ev.event_type === "MISSION_START") {
        return {
          valid: false,
          error: "\u062F\u0631 \u062D\u06CC\u0646 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A \u0641\u0642\u0637 \u062B\u0628\u062A \xAB\u0628\u0627\u0632\u06AF\u0634\u062A \u0627\u0632 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A\xBB \u06CC\u0627 \xAB\u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631\xBB \u0645\u062C\u0627\u0632 \u0627\u0633\u062A."
        };
      }
      if (ev.event_type === "MISSION_END") {
        state = "WORKING";
      } else if (ev.event_type === "WORK_END") {
        state = "IDLE";
      }
    }
  }
  return { valid: true };
}
function getDayShiftSchedule(dayOfWeek, settings) {
  const isThursday = dayOfWeek === 4;
  const shiftStartHHMM = isThursday ? settings.thursday_shift_start_time || settings.shift_start_time : settings.shift_start_time;
  const shiftEndHHMM = isThursday ? settings.thursday_shift_end_time || settings.shift_end_time : settings.shift_end_time;
  const overtimeStartHHMM = isThursday ? settings.thursday_overtime_start_time || shiftEndHHMM : settings.overtime_start_time;
  return {
    shiftStartHHMM,
    shiftEndHHMM,
    overtimeStartHHMM,
    shiftStartMin: parseTimeToMinutes(shiftStartHHMM),
    shiftEndMin: parseTimeToMinutes(shiftEndHHMM),
    overtimeStartMin: parseTimeToMinutes(overtimeStartHHMM)
  };
}
function calculateDailyAttendance(workDate, shamsiDate, dayLogs, settings, options) {
  const isToday = options?.isToday ?? false;
  const currentTimeHHMM = options?.currentTimeHHMM ?? "00:00";
  const activeLogs = [...dayLogs].filter((l) => !l.is_deleted).sort(
    (a, b) => normalizeTimeHHMMSS(a.recorded_time).localeCompare(normalizeTimeHHMMSS(b.recorded_time)) || a.id - b.id
  );
  const dayOfWeek = getDayOfWeekFromGregorian(workDate);
  const dayName = getPersianDayName(workDate);
  const isFriday = dayOfWeek === 5;
  const normShamsi = isValidShamsiDate(shamsiDate) ? normalizeShamsiDate(shamsiDate) : shamsiDate;
  const isOfficialHoliday = settings.official_holidays.some(
    (h) => (isValidShamsiDate(h) ? normalizeShamsiDate(h) : h) === normShamsi
  );
  const isHolidayOrFriday = isFriday || isOfficialHoliday;
  const isWorkingDay = settings.working_days.includes(dayOfWeek) && !isOfficialHoliday;
  const isHolidayWorkDisabled = isHolidayOrFriday && settings.friday_holiday_policy === "DISABLED";
  const { shiftStartMin, overtimeStartMin } = getDayShiftSchedule(dayOfWeek, settings);
  const graceMin = settings.grace_period_minutes;
  if (activeLogs.length === 0) {
    return {
      work_date: workDate,
      shamsi_date: normShamsi,
      day_name: dayName,
      is_holiday_or_friday: isHolidayOrFriday,
      is_working_day: isWorkingDay,
      logs: [],
      first_in_time: null,
      last_out_time: null,
      is_incomplete: false,
      is_late: false,
      late_minutes: 0,
      gross_presence_minutes: 0,
      mission_minutes: 0,
      break_deducted_minutes: 0,
      net_work_minutes: 0,
      provisional_work_minutes: 0,
      overtime_minutes: 0,
      status_label: isWorkingDay ? "\u063A\u06CC\u0628\u062A / \u0628\u062F\u0648\u0646 \u062B\u0628\u062A" : "\u062A\u0639\u0637\u06CC\u0644"
    };
  }
  const firstLog = activeLogs[0];
  const lastLog = activeLogs[activeLogs.length - 1];
  const firstInMin = parseTimeToMinutes(firstLog.recorded_time);
  const firstWorkStartLog = activeLogs.find((l) => l.event_type === "WORK_START") || firstLog;
  let rawLateMinutes = 0;
  if (isWorkingDay && firstInMin > shiftStartMin + graceMin) {
    rawLateMinutes = firstInMin - shiftStartMin;
  }
  const rawLateStatus = firstWorkStartLog.late_status;
  const effectiveLateStatus = rawLateStatus && rawLateStatus !== "NONE" ? rawLateStatus : rawLateMinutes > 0 ? "PENDING" : "NONE";
  let isLate = rawLateMinutes > 0;
  let lateMinutes = rawLateMinutes;
  const isClosed = lastLog.event_type === "WORK_END";
  const isIncomplete = !isClosed;
  let workSiteMinutes = 0;
  let missionMinutes = 0;
  let overtimeRawMinutes = 0;
  let currentPhase = "IDLE";
  let phaseStartMin = 0;
  const accumulateInterval = (startMin, endMin, phase) => {
    if (endMin <= startMin) return;
    const duration = endMin - startMin;
    if (phase === "WORK") {
      workSiteMinutes += duration;
    } else if (phase === "MISSION") {
      missionMinutes += duration;
    }
    if (isHolidayWorkDisabled) {
      return;
    }
    const isPayablePhase = phase === "WORK" || settings.mission_policy === "PAID_AS_WORK";
    if (!isPayablePhase) {
      return;
    }
    if (isHolidayOrFriday && settings.friday_holiday_policy === "ALL_OVERTIME") {
      overtimeRawMinutes += duration;
      return;
    }
    if (endMin > overtimeStartMin) {
      const otStart = Math.max(startMin, overtimeStartMin);
      overtimeRawMinutes += Math.max(0, endMin - otStart);
    }
    if (settings.overtime_before_shift && startMin < shiftStartMin) {
      const otEnd = Math.min(endMin, shiftStartMin);
      overtimeRawMinutes += Math.max(0, otEnd - startMin);
    }
  };
  for (const log of activeLogs) {
    const tMin = parseTimeToMinutes(log.recorded_time);
    if (log.event_type === "WORK_START") {
      if (currentPhase === "WORK" || currentPhase === "MISSION") {
        accumulateInterval(phaseStartMin, tMin, currentPhase);
      }
      currentPhase = "WORK";
      phaseStartMin = tMin;
    } else if (log.event_type === "MISSION_START") {
      if (currentPhase === "WORK" || currentPhase === "MISSION") {
        accumulateInterval(phaseStartMin, tMin, currentPhase);
      }
      currentPhase = "MISSION";
      phaseStartMin = tMin;
    } else if (log.event_type === "MISSION_END") {
      if (currentPhase === "MISSION") {
        accumulateInterval(phaseStartMin, tMin, "MISSION");
      }
      currentPhase = "WORK";
      phaseStartMin = tMin;
    } else if (log.event_type === "WORK_END") {
      if (currentPhase === "WORK" || currentPhase === "MISSION") {
        accumulateInterval(phaseStartMin, tMin, currentPhase);
      }
      currentPhase = "IDLE";
    }
  }
  let provisionalExtraMinutes = 0;
  let provisionalOvertimeMinutes = 0;
  if (isIncomplete && isToday && currentPhase !== "IDLE" && !isHolidayWorkDisabled) {
    const nowMin = parseTimeToMinutes(currentTimeHHMM);
    const isPayablePhase = currentPhase === "WORK" || settings.mission_policy === "PAID_AS_WORK";
    if (nowMin > phaseStartMin && isPayablePhase) {
      provisionalExtraMinutes = nowMin - phaseStartMin;
      if (isHolidayOrFriday && settings.friday_holiday_policy === "ALL_OVERTIME") {
        provisionalOvertimeMinutes = provisionalExtraMinutes;
      } else {
        if (nowMin > overtimeStartMin) {
          const otStart = Math.max(phaseStartMin, overtimeStartMin);
          provisionalOvertimeMinutes += Math.max(0, nowMin - otStart);
        }
        if (settings.overtime_before_shift && phaseStartMin < shiftStartMin) {
          const otEnd = Math.min(nowMin, shiftStartMin);
          provisionalOvertimeMinutes += Math.max(0, otEnd - phaseStartMin);
        }
      }
    }
  }
  const effectiveGrossConfirmed = isHolidayWorkDisabled ? 0 : settings.mission_policy === "PAID_AS_WORK" ? workSiteMinutes + missionMinutes : workSiteMinutes;
  const breakDeducted = isClosed && !isHolidayWorkDisabled && effectiveGrossConfirmed > 240 ? Math.min(settings.break_duration_minutes, effectiveGrossConfirmed) : 0;
  let netWorkMinutes = isClosed && !isHolidayWorkDisabled ? Math.max(0, effectiveGrossConfirmed - breakDeducted) : 0;
  let confirmedOvertimeMinutes = isClosed && !isHolidayWorkDisabled ? isHolidayOrFriday && settings.friday_holiday_policy === "ALL_OVERTIME" ? Math.min(overtimeRawMinutes, netWorkMinutes) : overtimeRawMinutes : 0;
  let lateDeductionToman = 0;
  const deductionRates = calculateLateAndAbsenceRates(settings);
  if (effectiveLateStatus === "EXCUSED") {
    isLate = false;
    lateMinutes = 0;
    lateDeductionToman = 0;
  } else if (effectiveLateStatus === "DEDUCT_LEAVE") {
    isLate = false;
    lateMinutes = rawLateMinutes;
    lateDeductionToman = 0;
  } else if (effectiveLateStatus === "APPROVED_DELAY") {
    isLate = true;
    lateMinutes = rawLateMinutes;
    lateDeductionToman = deductionRates.lateUnit === "HOUR" ? Math.round(rawLateMinutes / 60 * deductionRates.effectiveLateRatePerUnitToman) : Math.round(rawLateMinutes * deductionRates.effectiveLateRatePerUnitToman);
  } else if (effectiveLateStatus === "ABSENCE") {
    isLate = true;
    lateMinutes = rawLateMinutes;
    netWorkMinutes = 0;
    confirmedOvertimeMinutes = 0;
    lateDeductionToman = deductionRates.effectiveDailyAbsenceRateToman;
  } else if (effectiveLateStatus === "CUSTOM") {
    isLate = true;
    lateMinutes = rawLateMinutes;
    lateDeductionToman = Math.max(
      0,
      Math.round(Number(firstWorkStartLog.custom_deduction_toman || 0))
    );
  }
  const provisionalGross = effectiveGrossConfirmed + provisionalExtraMinutes;
  const provisionalTotalMinutes = isHolidayWorkDisabled || effectiveLateStatus === "ABSENCE" ? 0 : Math.max(
    0,
    provisionalGross - (provisionalGross > 240 ? settings.break_duration_minutes : 0)
  );
  let statusLabel = "\u062B\u0628\u062A \u0642\u0637\u0639\u06CC";
  if (effectiveLateStatus === "ABSENCE") {
    statusLabel = "\u062B\u0628\u062A \u063A\u06CC\u0628\u062A (\u062A\u0635\u0645\u06CC\u0645 \u0645\u062F\u06CC\u0631)";
  } else if (isIncomplete) {
    statusLabel = isToday ? "\u062F\u0631 \u062D\u0627\u0644 \u06A9\u0627\u0631 (\u062C\u0627\u0631\u06CC)" : "\u0631\u06A9\u0648\u0631\u062F \u0646\u0627\u0642\u0635 (\u0646\u06CC\u0627\u0632\u0645\u0646\u062F \u062B\u0628\u062A \u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631)";
  } else if (isHolidayWorkDisabled) {
    statusLabel = "\u062A\u0639\u0637\u06CC\u0644 (\u06A9\u0627\u0631 \u062F\u0631 \u062A\u0639\u0637\u06CC\u0644\u0627\u062A \u063A\u06CC\u0631\u0641\u0639\u0627\u0644)";
  } else if (isHolidayOrFriday) {
    statusLabel = "\u06A9\u0627\u0631 \u062F\u0631 \u0631\u0648\u0632 \u062A\u0639\u0637\u06CC\u0644";
  } else if (effectiveLateStatus === "EXCUSED") {
    statusLabel = "\u062B\u0628\u062A \u0628\u062F\u0648\u0646 \u062A\u0623\u062E\u06CC\u0631 (\u062A\u0623\u06CC\u06CC\u062F \u0645\u062F\u06CC\u0631)";
  } else if (effectiveLateStatus === "DEDUCT_LEAVE") {
    statusLabel = "\u06A9\u0633\u0631 \u0627\u0632 \u0645\u0631\u062E\u0635\u06CC (\u0628\u0627\u0628\u062A \u062A\u0623\u062E\u06CC\u0631)";
  } else if (effectiveLateStatus === "APPROVED_DELAY") {
    statusLabel = "\u062D\u0636\u0648\u0631 \u0628\u0627 \u062A\u0623\u062E\u06CC\u0631 (\u06A9\u0633\u0631 \u062A\u0623\u062E\u06CC\u0631)";
  } else if (effectiveLateStatus === "CUSTOM") {
    statusLabel = "\u062D\u0636\u0648\u0631 \u0628\u0627 \u062A\u0623\u062E\u06CC\u0631 (\u062A\u0639\u06CC\u06CC\u0646 \u062A\u06A9\u0644\u06CC\u0641 \u0645\u062F\u06CC\u0631)";
  } else if (isLate) {
    statusLabel = "\u062D\u0636\u0648\u0631 \u0628\u0627 \u062A\u0623\u062E\u06CC\u0631";
  }
  return {
    work_date: workDate,
    shamsi_date: normShamsi,
    day_name: dayName,
    is_holiday_or_friday: isHolidayOrFriday,
    is_working_day: isWorkingDay,
    logs: activeLogs,
    first_in_time: firstLog.recorded_time.slice(0, 5),
    last_out_time: isClosed ? lastLog.recorded_time.slice(0, 5) : null,
    is_incomplete: isIncomplete,
    is_late: isLate,
    raw_late_minutes: rawLateMinutes,
    late_minutes: lateMinutes,
    late_status: effectiveLateStatus,
    late_reason: firstWorkStartLog.late_reason || firstWorkStartLog.note || null,
    manager_late_note: firstWorkStartLog.manager_late_note || null,
    late_deduction_toman: lateDeductionToman,
    custom_deduction_toman: firstWorkStartLog.custom_deduction_toman != null ? Number(firstWorkStartLog.custom_deduction_toman) : null,
    late_reviewed_at: firstWorkStartLog.late_reviewed_at || null,
    is_late_seen_by_worker: firstWorkStartLog.is_late_seen_by_worker !== void 0 ? Boolean(firstWorkStartLog.is_late_seen_by_worker) : true,
    first_in_log_id: firstWorkStartLog.id || null,
    gross_presence_minutes: isClosed ? effectiveGrossConfirmed : 0,
    mission_minutes: missionMinutes,
    break_deducted_minutes: breakDeducted,
    net_work_minutes: netWorkMinutes,
    provisional_work_minutes: isToday && isIncomplete ? provisionalTotalMinutes : netWorkMinutes,
    overtime_minutes: isToday && isIncomplete ? overtimeRawMinutes + provisionalOvertimeMinutes : confirmedOvertimeMinutes,
    status_label: statusLabel
  };
}
function evaluateWorkerLiveState(todayLogs, settings, referenceDate = /* @__PURE__ */ new Date()) {
  const nowInfo = getNowInTimezone(settings.timezone, referenceDate);
  const nowMin = parseTimeToMinutes(nowInfo.timeHHMM);
  const dayOfWeek = getDayOfWeekFromGregorian(nowInfo.workDate);
  const { shiftStartHHMM, shiftStartMin, shiftEndMin, overtimeStartMin } = getDayShiftSchedule(
    dayOfWeek,
    settings
  );
  const graceMin = settings.grace_period_minutes;
  const todaySummary = calculateDailyAttendance(
    nowInfo.workDate,
    nowInfo.shamsiDate,
    todayLogs,
    settings,
    {
      isToday: true,
      currentTimeHHMM: nowInfo.timeHHMM
    }
  );
  const activeLogs = todaySummary.logs;
  const allowedNext = getAllowedNextEvents(activeLogs);
  const lastEvent = activeLogs.length > 0 ? activeLogs[activeLogs.length - 1] : null;
  let status = "FINISHED";
  let statusText = "\u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631 / \u062E\u0627\u0631\u062C \u0627\u0632 \u0634\u06CC\u0641\u062A";
  let statusDetail = "\u0647\u0646\u0648\u0632 \u062A\u0631\u062F\u062F\u06CC \u0628\u0631\u0627\u06CC \u0627\u0645\u0631\u0648\u0632 \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A";
  let isOvertimeActive = false;
  if (!lastEvent) {
    if (todaySummary.is_working_day && nowMin > shiftStartMin + graceMin && nowMin <= shiftEndMin + 120) {
      status = "ABSENT";
      statusText = "\u063A\u06CC\u0628\u062A (\u0639\u062F\u0645 \u062B\u0628\u062A \u0648\u0631\u0648\u062F)";
      statusDetail = `\u0633\u0627\u0639\u062A \u0634\u0631\u0648\u0639 \u0634\u06CC\u0641\u062A ${shiftStartHHMM} \u0628\u0648\u062F\u0647 \u0648 \u062A\u0627\u06A9\u0646\u0648\u0646 \u0648\u0631\u0648\u062F\u06CC \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A`;
    } else {
      status = "FINISHED";
      statusText = todaySummary.is_working_day ? "\u062E\u0627\u0631\u062C \u0627\u0632 \u0634\u06CC\u0641\u062A (\u067E\u06CC\u0634 \u0627\u0632 \u0634\u0631\u0648\u0639)" : "\u0631\u0648\u0632 \u063A\u06CC\u0631\u06A9\u0627\u0631\u06CC / \u062A\u0639\u0637\u06CC\u0644";
      statusDetail = todaySummary.is_working_day ? `\u0634\u0631\u0648\u0639 \u0634\u06CC\u0641\u062A \u0627\u0645\u0631\u0648\u0632 \u0633\u0627\u0639\u062A ${shiftStartHHMM}` : "\u0627\u0645\u0631\u0648\u0632 \u062F\u0631 \u062A\u0642\u0648\u06CC\u0645 \u06A9\u0627\u0631\u06CC \u0633\u0627\u0645\u0627\u0646\u0647 \u062A\u0639\u0637\u06CC\u0644 \u0627\u0633\u062A";
    }
  } else {
    if (lastEvent.event_type === "WORK_END") {
      status = "FINISHED";
      statusText = "\u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631";
      statusDetail = `\u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631 \u062F\u0631 \u0633\u0627\u0639\u062A ${lastEvent.recorded_time.slice(0, 5)} \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A`;
      isOvertimeActive = false;
    } else if (lastEvent.event_type === "MISSION_START") {
      status = "MISSION";
      statusText = "\u062F\u0631 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A";
      statusDetail = `\u0634\u0631\u0648\u0639 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A \u0627\u0632 \u0633\u0627\u0639\u062A ${lastEvent.recorded_time.slice(0, 5)}`;
      if (settings.mission_policy === "PAID_AS_WORK" && !(todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === "DISABLED")) {
        if (todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === "ALL_OVERTIME" || nowMin >= overtimeStartMin || settings.overtime_before_shift && nowMin < shiftStartMin) {
          isOvertimeActive = true;
        }
      }
    } else {
      if (todaySummary.is_late) {
        status = "LATE";
        statusText = "\u062D\u0636\u0648\u0631 \u0628\u0627 \u062A\u0623\u062E\u06CC\u0631";
        statusDetail = `\u0648\u0631\u0648\u062F \u0633\u0627\u0639\u062A ${todaySummary.first_in_time} (${todaySummary.late_minutes} \u062F\u0642\u06CC\u0642\u0647 \u062A\u0623\u062E\u06CC\u0631 \u0646\u0633\u0628\u062A \u0628\u0647 ${shiftStartHHMM})`;
      } else {
        status = "PRESENT";
        statusText = "\u062D\u0627\u0636\u0631 \u062F\u0631 \u0645\u062D\u0644 \u06A9\u0627\u0631";
        statusDetail = `\u0648\u0631\u0648\u062F \u062F\u0631 \u0633\u0627\u0639\u062A ${todaySummary.first_in_time}`;
      }
      if (!(todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === "DISABLED")) {
        if (todaySummary.is_holiday_or_friday && settings.friday_holiday_policy === "ALL_OVERTIME" || nowMin >= overtimeStartMin || settings.overtime_before_shift && nowMin < shiftStartMin) {
          isOvertimeActive = true;
        }
      }
    }
  }
  return {
    status,
    status_text: statusText,
    status_detail: statusDetail,
    is_overtime_active: isOvertimeActive,
    last_event: lastEvent,
    allowed_next_events: allowedNext,
    today_summary: todaySummary
  };
}
var STANDARD_MONTHLY_WORK_DAYS = 26;
var STANDARD_DAILY_WORK_HOURS = 8;
var STANDARD_MONTHLY_WORK_HOURS = STANDARD_MONTHLY_WORK_DAYS * STANDARD_DAILY_WORK_HOURS;
function getMonthlyCycleKeyForShamsiDate(shamsiDate, anchorDay = 15) {
  if (!shamsiDate || !isValidShamsiDate(shamsiDate)) {
    return "1405/06/15";
  }
  const norm = normalizeShamsiDate(shamsiDate);
  const [jy, jm, jd] = norm.split("/").map(Number);
  const safeAnchor = Math.min(29, Math.max(1, Math.round(Number(anchorDay) || 15)));
  if (jd >= safeAnchor) {
    return `${jy}/${pad2(jm)}/${pad2(safeAnchor)}`;
  }
  const prevJm = jm === 1 ? 12 : jm - 1;
  const prevJy = jm === 1 ? jy - 1 : jy;
  return `${prevJy}/${pad2(prevJm)}/${pad2(safeAnchor)}`;
}
function calculateSalaryAndOvertimeRates(settings, totalOvertimeMinutes) {
  const baseSalaryToman = settings.base_salary_toman && settings.base_salary_toman > 0 ? Math.round(settings.base_salary_toman) : 0;
  const safeOvertimeMinutes = Math.max(0, Number(totalOvertimeMinutes) || 0);
  const dailyBaseRateToman = baseSalaryToman > 0 ? Math.round(baseSalaryToman / STANDARD_MONTHLY_WORK_DAYS) : 0;
  const effectiveHourlyRateToman = settings.hourly_rate_toman && settings.hourly_rate_toman > 0 ? Math.round(settings.hourly_rate_toman) : baseSalaryToman > 0 ? Math.round(baseSalaryToman / STANDARD_MONTHLY_WORK_HOURS) : 0;
  let effectiveOvertimeHourlyRateToman = 0;
  if (settings.overtime_calc_mode === "FIXED_RATE" && settings.overtime_rate_toman && settings.overtime_rate_toman > 0) {
    effectiveOvertimeHourlyRateToman = Math.round(settings.overtime_rate_toman);
  } else if (settings.overtime_calc_mode === "PERCENTAGE") {
    const pct = settings.overtime_percentage && settings.overtime_percentage > 0 ? settings.overtime_percentage : 140;
    effectiveOvertimeHourlyRateToman = Math.round(effectiveHourlyRateToman * (pct / 100));
  } else if (settings.overtime_rate_toman && settings.overtime_rate_toman > 0) {
    effectiveOvertimeHourlyRateToman = Math.round(settings.overtime_rate_toman);
  }
  const totalOvertimePayToman = Math.round(
    safeOvertimeMinutes / 60 * effectiveOvertimeHourlyRateToman
  );
  return {
    baseSalaryToman,
    dailyBaseRateToman,
    effectiveHourlyRateToman,
    effectiveOvertimeHourlyRateToman,
    totalOvertimePayToman
  };
}
function calculateLateAndAbsenceRates(settings) {
  const baseRates = calculateSalaryAndOvertimeRates(settings, 0);
  const legalHourlyRateToman = baseRates.effectiveHourlyRateToman;
  const legalMinuteRateToman = legalHourlyRateToman > 0 ? Math.round(legalHourlyRateToman / 60) : 0;
  const legalDailyAbsenceRateToman = baseRates.dailyBaseRateToman > 0 ? baseRates.dailyBaseRateToman : legalHourlyRateToman * STANDARD_DAILY_WORK_HOURS;
  const lateUnit = settings.late_deduction_unit === "HOUR" ? "HOUR" : "MINUTE";
  const customLateRate = settings.late_deduction_rate_toman != null && Number(settings.late_deduction_rate_toman) > 0 ? Math.round(Number(settings.late_deduction_rate_toman)) : null;
  const effectiveLateRatePerUnitToman = customLateRate !== null ? customLateRate : lateUnit === "HOUR" ? legalHourlyRateToman : legalMinuteRateToman;
  const effectiveLateMinuteRateToman = lateUnit === "HOUR" ? Math.round(effectiveLateRatePerUnitToman / 60) : effectiveLateRatePerUnitToman;
  const effectiveLateHourlyRateToman = lateUnit === "HOUR" ? effectiveLateRatePerUnitToman : effectiveLateRatePerUnitToman * 60;
  const absenceUnit = settings.absence_deduction_unit === "HOUR" ? "HOUR" : "DAY";
  const customAbsenceRate = settings.absence_deduction_rate_toman != null && Number(settings.absence_deduction_rate_toman) > 0 ? Math.round(Number(settings.absence_deduction_rate_toman)) : null;
  const effectiveAbsenceRatePerUnitToman = customAbsenceRate !== null ? customAbsenceRate : absenceUnit === "HOUR" ? legalHourlyRateToman : legalDailyAbsenceRateToman;
  const effectiveDailyAbsenceRateToman = absenceUnit === "HOUR" ? effectiveAbsenceRatePerUnitToman * STANDARD_DAILY_WORK_HOURS : effectiveAbsenceRatePerUnitToman;
  const effectiveHourlyAbsenceRateToman = absenceUnit === "HOUR" ? effectiveAbsenceRatePerUnitToman : Math.round(effectiveAbsenceRatePerUnitToman / STANDARD_DAILY_WORK_HOURS);
  return {
    lateUnit,
    absenceUnit,
    legalHourlyRateToman,
    legalMinuteRateToman,
    legalDailyAbsenceRateToman,
    effectiveLateRatePerUnitToman,
    effectiveLateMinuteRateToman,
    effectiveLateHourlyRateToman,
    effectiveAbsenceRatePerUnitToman,
    effectiveDailyAbsenceRateToman,
    effectiveHourlyAbsenceRateToman,
    isCustomLateRate: customLateRate !== null,
    isCustomAbsenceRate: customAbsenceRate !== null
  };
}

// src/server/melipayamak.ts
var MELIPAYAMAK_ERROR_CODES = {
  "0": "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u06CC\u0627 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 (\u06A9\u0644\u06CC\u062F \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633) \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u0635\u062D\u06CC\u062D \u0646\u06CC\u0633\u062A.",
  "2": "\u0627\u0639\u062A\u0628\u0627\u0631 \u067E\u0646\u0644 \u067E\u06CC\u0627\u0645\u06A9 \u06A9\u0627\u0641\u06CC \u0646\u06CC\u0633\u062A.",
  "3": "\u0645\u062D\u062F\u0648\u062F\u06CC\u062A \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u0631\u0648\u0632\u0627\u0646\u0647 \u067E\u0646\u0644 \u067E\u06CC\u0627\u0645\u06A9.",
  "4": "\u0645\u062D\u062F\u0648\u062F\u06CC\u062A \u062F\u0631 \u062D\u062C\u0645 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645\u06A9.",
  "5": "\u0634\u0645\u0627\u0631\u0647 \u062E\u0637 \u0641\u0631\u0633\u062A\u0646\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A \u06CC\u0627 \u0645\u062A\u0639\u0644\u0642 \u0628\u0647 \u0627\u06CC\u0646 \u067E\u0646\u0644 \u0646\u0645\u06CC\u200C\u0628\u0627\u0634\u062F.",
  "6": "\u0633\u0627\u0645\u0627\u0646\u0647 \u067E\u06CC\u0627\u0645\u06A9\u06CC \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0627\u0633\u062A.",
  "7": "\u0645\u062A\u0646 \u067E\u06CC\u0627\u0645\u06A9 \u062D\u0627\u0648\u06CC \u06A9\u0644\u0645\u0647 \u0641\u06CC\u0644\u062A\u0631\u0634\u062F\u0647 \u0627\u0633\u062A.",
  "9": "\u0627\u0631\u0633\u0627\u0644 \u0627\u0632 \u062E\u0637\u0648\u0637 \u0639\u0645\u0648\u0645\u06CC \u0627\u0632 \u0637\u0631\u06CC\u0642 \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u0627\u0645\u06A9\u0627\u0646\u200C\u067E\u0630\u06CC\u0631 \u0646\u06CC\u0633\u062A.",
  "10": "\u06A9\u0627\u0631\u0628\u0631 \u067E\u0646\u0644 \u067E\u06CC\u0627\u0645\u06A9\u06CC \u0641\u0639\u0627\u0644 \u0646\u06CC\u0633\u062A.",
  "11": "\u06A9\u062F \u06F1\u06F1 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 (\u0628\u0644\u06A9\u200C\u0644\u06CC\u0633\u062A \u0645\u062E\u0627\u0628\u0631\u0627\u062A): \u0634\u0645\u0627\u0631\u0647 \u06AF\u06CC\u0631\u0646\u062F\u0647 \u062F\u0631\u06CC\u0627\u0641\u062A \u067E\u06CC\u0627\u0645\u06A9\u200C\u0647\u0627\u06CC \u062A\u0628\u0644\u06CC\u063A\u0627\u062A\u06CC \u0631\u0627 \u0645\u0633\u062F\u0648\u062F \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A. \u0628\u0631\u0627\u06CC \u062F\u0631\u06CC\u0627\u0641\u062A \u067E\u06CC\u0627\u0645\u06A9 \u0627\u0632 \u062E\u0637 \u06F5\u06F0\u06F0\u06F0\u060C \u06AF\u06CC\u0631\u0646\u062F\u0647 \u0628\u0627\u06CC\u062F \u06A9\u062F *8999# \u0631\u0627 \u0634\u0645\u0627\u0631\u0647\u200C\u06AF\u06CC\u0631\u06CC \u06A9\u0646\u062F (\u06CC\u0627 \u062F\u0631 \u067E\u0646\u0644 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u0627\u0632 \u062E\u0637 \u062E\u062F\u0645\u0627\u062A\u06CC / \u06A9\u062F \u067E\u062A\u0631\u0646 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0634\u0648\u062F).",
  "12": "\u0645\u062F\u0627\u0631\u06A9 \u06A9\u0627\u0631\u0628\u0631\u06CC \u062F\u0631 \u067E\u0646\u0644 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u062A\u06A9\u0645\u06CC\u0644 \u06CC\u0627 \u062A\u0623\u06CC\u06CC\u062F \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.",
  "14": "\u0645\u062A\u0646 \u067E\u06CC\u0627\u0645\u06A9 \u062D\u0627\u0648\u06CC \u0644\u06CC\u0646\u06A9 \u0627\u0633\u062A \u0648 \u0633\u0631\u0634\u0645\u0627\u0631\u0647 \u0645\u062C\u0648\u0632 \u0627\u0631\u0633\u0627\u0644 \u0644\u06CC\u0646\u06A9 \u0646\u062F\u0627\u0631\u062F.",
  "15": "\u062F\u0631 \u0645\u062A\u0646 \u067E\u06CC\u0627\u0645\u06A9 \u0639\u0628\u0627\u0631\u062A \xAB\u0644\u063A\u064811\xBB \u062F\u0631\u062C \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.",
  "16": "\u0634\u0645\u0627\u0631\u0647 \u06AF\u06CC\u0631\u0646\u062F\u0647 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F.",
  "17": "\u0645\u062A\u0646 \u067E\u06CC\u0627\u0645\u06A9 \u062E\u0627\u0644\u06CC \u0627\u0633\u062A.",
  "35": "\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0627\u0631\u0633\u0627\u0644\u06CC \u0628\u0647 \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A.",
  "-108": "\u0622\u06CC\u200C\u067E\u06CC \u0633\u0631\u0648\u0631 \u0628\u0647 \u062F\u0644\u06CC\u0644 \u062A\u0644\u0627\u0634 \u0646\u0627\u0645\u0648\u0641\u0642 \u0645\u0633\u062F\u0648\u062F \u0634\u062F\u0647 \u0627\u0633\u062A.",
  "-109": "\u0645\u062D\u062F\u0648\u062F\u06CC\u062A \u0622\u06CC\u200C\u067E\u06CC (IP) \u062F\u0631 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u067E\u0646\u0644 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u0641\u0639\u0627\u0644 \u0627\u0633\u062A\u061B \u0644\u0637\u0641\u0627\u064B \u062F\u0631 \u067E\u0646\u0644 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u0645\u062D\u062F\u0648\u062F\u06CC\u062A IP \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u0631\u0627 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u06A9\u0646\u06CC\u062F.",
  "-110": "\u062F\u0631 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0627\u0645\u0646\u06CC\u062A\u06CC \u067E\u0646\u0644 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9\u060C \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0627\u0632 \u06A9\u0644\u06CC\u062F \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 (API Key) \u0627\u0644\u0632\u0627\u0645\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A."
};
function buildUsernameCandidates(rawUsername) {
  const clean = toEnglishDigits(rawUsername).trim();
  const set = /* @__PURE__ */ new Set();
  if (clean) set.add(clean);
  if (/^09\d{9}$/.test(clean)) {
    set.add(`98${clean.slice(1)}`);
    set.add(clean.slice(1));
  } else if (/^989\d{9}$/.test(clean)) {
    set.add(`0${clean.slice(2)}`);
    set.add(clean.slice(2));
  } else if (/^9\d{9}$/.test(clean)) {
    set.add(`98${clean}`);
    set.add(`0${clean}`);
  }
  return Array.from(set);
}
function normalizeRecipientPhone(rawPhone) {
  const clean = toEnglishDigits(rawPhone).replace(/\s+/g, "").trim();
  if (/^\+989\d{9}$/.test(clean)) {
    return `0${clean.slice(3)}`;
  }
  if (/^989\d{9}$/.test(clean)) {
    return `0${clean.slice(2)}`;
  }
  if (/^9\d{9}$/.test(clean)) {
    return `0${clean}`;
  }
  return clean;
}
async function checkMelipayamakCredit(usernameRaw, passwordRaw) {
  const candidates = buildUsernameCandidates(usernameRaw);
  const password = passwordRaw.trim();
  if (candidates.length === 0 || !password) {
    return { ok: false, message: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0648 \u0631\u0645\u0632 \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u0648\u0627\u0631\u062F \u0646\u0634\u062F\u0647 \u0627\u0633\u062A." };
  }
  for (const username of candidates) {
    try {
      const resp = await fetch("https://rest.payamak-panel.com/api/SendSMS/GetCredit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.RetStatus === 1 && data.Value) {
        const creditNum = Math.floor(Number(data.Value) || 0);
        return {
          ok: true,
          credit: creditNum,
          matchedUsername: username,
          message: `\u0627\u062A\u0635\u0627\u0644 \u0628\u0647 \u067E\u0646\u0644 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u0628\u0631\u0642\u0631\u0627\u0631 \u0627\u0633\u062A (\u0627\u0639\u062A\u0628\u0627\u0631 \u0641\u0639\u0644\u06CC: ${toPersianDigits(creditNum)} \u067E\u06CC\u0627\u0645\u06A9).`
        };
      }
    } catch {
    }
  }
  return {
    ok: false,
    message: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u06CC\u0627 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 (\u06A9\u0644\u06CC\u062F \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633) \u062F\u0631 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u062A\u0623\u06CC\u06CC\u062F \u0646\u0634\u062F."
  };
}
async function sendMelipayamakSms(settings, recipientPhone, text) {
  const cleanPhone = normalizeRecipientPhone(recipientPhone || "");
  const cleanFrom = toEnglishDigits(settings.melipayamak_from_number || "").trim();
  const rawUsername = (settings.melipayamak_username || "").trim();
  const password = (settings.melipayamak_password || "").trim();
  if (!cleanPhone || cleanPhone.length < 10) {
    return {
      sent: false,
      statusMessage: "\u0634\u0645\u0627\u0631\u0647 \u062A\u0644\u0641\u0646 \u0647\u0645\u0631\u0627\u0647 \u06AF\u06CC\u0631\u0646\u062F\u0647 \u062F\u0631 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u06CC\u0627 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A."
    };
  }
  if (!rawUsername || !password) {
    return {
      sent: false,
      statusMessage: "\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u067E\u0646\u0644 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u062F\u0631 \u0628\u062E\u0634 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u062A\u06A9\u0645\u06CC\u0644 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A."
    };
  }
  const usernameCandidates = buildUsernameCandidates(rawUsername);
  const isPatternBodyId = /^\d{4,7}$/.test(cleanFrom) && !cleanFrom.startsWith("5000") && !cleanFrom.startsWith("3000") && !cleanFrom.startsWith("2000") && !cleanFrom.startsWith("1000") && !cleanFrom.startsWith("9000");
  let finalSmsText = text.trim();
  if (cleanFrom.startsWith("5000") && !finalSmsText.includes("\u0644\u063A\u0648")) {
    finalSmsText = `${finalSmsText}
\u0644\u063A\u064811`;
  }
  let lastCode = "";
  for (const username of usernameCandidates) {
    try {
      if (isPatternBodyId) {
        const patternRes = await fetch(
          "https://rest.payamak-panel.com/api/SendSMS/SendByBaseNumber",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username,
              password,
              text: [text.trim()],
              to: cleanPhone,
              bodyId: Number(cleanFrom)
            })
          }
        );
        if (patternRes.ok) {
          const pData = await patternRes.json();
          const val = String(pData.Value || "").trim();
          if (val && /^\d+$/.test(val) && val.length > 12) {
            return {
              sent: true,
              rawCode: val,
              statusMessage: `\u067E\u06CC\u0627\u0645\u06A9 \u062E\u062F\u0645\u0627\u062A\u06CC \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u0634\u062F (\u06A9\u062F \u0631\u0647\u06AF\u06CC\u0631\u06CC: ${toPersianDigits(val)}).`
            };
          }
          if (val) lastCode = val;
        }
      }
      if (!cleanFrom) {
        return {
          sent: false,
          statusMessage: "\u0634\u0645\u0627\u0631\u0647 \u062E\u0637 \u0627\u0631\u0633\u0627\u0644\u200C\u06A9\u0646\u0646\u062F\u0647 \u062F\u0631 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u067E\u06CC\u0627\u0645\u06A9 \u0648\u0627\u0631\u062F \u0646\u0634\u062F\u0647 \u0627\u0633\u062A."
        };
      }
      const restResp = await fetch("https://rest.payamak-panel.com/api/SendSMS/SendSMS", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          to: cleanPhone,
          from: cleanFrom,
          text: finalSmsText,
          isFlash: Boolean(settings.melipayamak_is_flash)
        })
      });
      if (restResp.ok) {
        const data = await restResp.json();
        const code = String(data.Value ?? "").trim();
        if (/^\d+$/.test(code) && code.length > 4) {
          return {
            sent: true,
            rawCode: code,
            statusMessage: `\u067E\u06CC\u0627\u0645\u06A9 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u0634\u062F (\u06A9\u062F \u0631\u0647\u06AF\u06CC\u0631\u06CC: ${toPersianDigits(code)}).`
          };
        }
        if (code === "0" || data.RetStatus === 0) {
          lastCode = "0";
          continue;
        }
        if (code) {
          lastCode = code;
          break;
        }
      }
      const formData = new URLSearchParams();
      formData.append("username", username);
      formData.append("password", password);
      formData.append("to", cleanPhone);
      formData.append("from", cleanFrom);
      formData.append("text", finalSmsText);
      formData.append("isflash", settings.melipayamak_is_flash ? "true" : "false");
      const soapResp = await fetch(
        "https://api.payamak-panel.com/post/Send.asmx/SendSimpleSMS2",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
          },
          body: formData.toString()
        }
      );
      if (soapResp.ok) {
        const rawXml = await soapResp.text();
        const match = rawXml.match(/<string[^>]*>([^<]+)<\/string>/i);
        const extracted = match ? match[1].trim() : rawXml.trim();
        if (/^\d+$/.test(extracted) && extracted.length > 4) {
          return {
            sent: true,
            rawCode: extracted,
            statusMessage: `\u067E\u06CC\u0627\u0645\u06A9 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u0634\u062F (\u06A9\u062F \u0631\u0647\u06AF\u06CC\u0631\u06CC: ${toPersianDigits(extracted)}).`
          };
        }
        if (extracted === "0") {
          lastCode = "0";
          continue;
        }
        lastCode = extracted;
        break;
      }
    } catch (err) {
      return {
        sent: false,
        statusMessage: `\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u062A\u0628\u0627\u0637 \u0634\u0628\u06A9\u0647 \u0628\u0627 \u0633\u0631\u0648\u0631 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9: ${err.message}`
      };
    }
  }
  const knownReason = MELIPAYAMAK_ERROR_CODES[lastCode] || `\u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645\u06A9 \u062A\u0648\u0633\u0637 \u0627\u067E\u0631\u0627\u062A\u0648\u0631 \u0631\u062F \u0634\u062F (\u06A9\u062F \u0648\u0636\u0639\u06CC\u062A \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9: ${toPersianDigits(lastCode || "\u0646\u0627\u0645\u0634\u062E\u0635")}).`;
  return {
    sent: false,
    rawCode: lastCode,
    statusMessage: knownReason
  };
}

// src/server/routes.ts
var apiRouter = (0, import_express.Router)();
var ValidationError = class extends Error {
  constructor(statusCode, message, code = "INVALID_FILE") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
};
function sanitizeSettingsForRole(settings, role) {
  if (role !== "manager") {
    return {
      ...settings,
      melipayamak_username: "",
      melipayamak_password: "",
      melipayamak_from_number: ""
    };
  }
  return {
    ...settings,
    melipayamak_password: settings.melipayamak_password ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : ""
  };
}
function detectFileSignature(buf) {
  if (buf.length < 4) return "unknown";
  if (buf[0] === 77 && buf[1] === 90 || // MZ (.exe/.dll)
  buf[0] === 127 && buf[1] === 69 && buf[2] === 76 && buf[3] === 70) {
    return "dangerous";
  }
  const headText = buf.subarray(0, Math.min(256, buf.length)).toString("utf8").toLowerCase();
  if (headText.includes("<script") || headText.includes("<?php") || headText.startsWith("#!/") || headText.includes("<html")) {
    return "dangerous";
  }
  if (buf.length >= 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71 && buf[4] === 13 && buf[5] === 10 && buf[6] === 26 && buf[7] === 10) {
    return "png";
  }
  if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) {
    return "jpg";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  if (buf.subarray(0, 4).toString("ascii") === "%PDF") {
    return "pdf";
  }
  if (buf[0] === 80 && buf[1] === 75 && buf[2] === 3 && buf[3] === 4) {
    return "xlsx";
  }
  if (buf[0] === 208 && buf[1] === 207 && buf[2] === 17 && buf[3] === 224) {
    return "xls";
  }
  if (buf[0] === 26 && buf[1] === 69 && buf[2] === 223 && buf[3] === 163 || buf.subarray(0, 4).toString("ascii") === "OggS" || buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE" || buf.length >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp" || buf.subarray(0, 3).toString("ascii") === "ID3" || buf[0] === 255 && (buf[1] & 224) === 224) {
    return "audio";
  }
  return "unknown";
}
function saveBase64MediaFile(subFolder, originalName, base64Data) {
  const rawName = String(originalName || "upload.jpg").trim().replace(/[/\\]/g, "_");
  if (!rawName || rawName.includes("\0") || rawName.includes("..")) {
    throw new ValidationError(400, "\u0646\u0627\u0645 \u0641\u0627\u06CC\u0644 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u06CC\u0627 \u062D\u0627\u0648\u06CC \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631\u0647\u0627\u06CC \u063A\u06CC\u0631\u0645\u062C\u0627\u0632 \u0627\u0633\u062A.");
  }
  const cleanBase64 = (base64Data.includes(",") ? base64Data.split(",")[1] : base64Data).trim();
  if (!cleanBase64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(cleanBase64)) {
    throw new ValidationError(400, "\u0645\u062D\u062A\u0648\u0627\u06CC \u0641\u0627\u06CC\u0644 \u0627\u0631\u0633\u0627\u0644\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A.");
  }
  const buffer = Buffer.from(cleanBase64, "base64");
  if (buffer.length < 8) {
    throw new ValidationError(400, "\u0641\u0627\u06CC\u0644 \u0627\u0631\u0633\u0627\u0644\u06CC \u062E\u0627\u0644\u06CC \u06CC\u0627 \u062E\u0631\u0627\u0628 \u0627\u0633\u062A.");
  }
  const maxBytesByFolder = {
    avatars: Math.floor(5 * 1024 * 1024),
    excel: 5 * 1024 * 1024,
    reports: 10 * 1024 * 1024,
    receipts: 10 * 1024 * 1024,
    attachments: 10 * 1024 * 1024,
    audio: 10 * 1024 * 1024
  };
  if (buffer.length > maxBytesByFolder[subFolder]) {
    throw new ValidationError(413, "\u062D\u062C\u0645 \u0641\u0627\u06CC\u0644 \u0627\u0631\u0633\u0627\u0644\u06CC \u0628\u06CC\u0634 \u0627\u0632 \u0633\u0642\u0641 \u0645\u062C\u0627\u0632 (\u06F1\u06F0 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A) \u0627\u0633\u062A.", "FILE_TOO_LARGE");
  }
  const detectedSig = detectFileSignature(buffer);
  if (detectedSig === "dangerous" || detectedSig === "unknown") {
    throw new ValidationError(400, "\u0646\u0648\u0639 \u0648\u0627\u0642\u0639\u06CC \u0641\u0627\u06CC\u0644 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u06CC\u0627 \u063A\u06CC\u0631\u0645\u062C\u0627\u0632 \u0627\u0633\u062A.");
  }
  const sigToExts = {
    png: [".png"],
    jpg: [".jpg", ".jpeg"],
    webp: [".webp"],
    pdf: [".pdf"],
    xlsx: [".xlsx"],
    xls: [".xls"],
    audio: [".webm", ".ogg", ".mp4", ".wav", ".mp3", ".m4a"]
  };
  const defaultExtForSig = {
    png: ".png",
    jpg: ".jpg",
    webp: ".webp",
    pdf: ".pdf",
    xlsx: ".xlsx",
    xls: ".xls",
    audio: ".webm"
  };
  let ext = import_path3.default.extname(rawName).toLowerCase();
  if (!ext || !sigToExts[detectedSig]?.includes(ext)) {
    if (defaultExtForSig[detectedSig]) {
      ext = defaultExtForSig[detectedSig];
    }
  }
  const allowedExtsByFolder = {
    avatars: [".png", ".jpg", ".jpeg", ".webp"],
    reports: [".png", ".jpg", ".jpeg", ".webp"],
    receipts: [".png", ".jpg", ".jpeg", ".webp", ".pdf"],
    attachments: [".png", ".jpg", ".jpeg", ".webp", ".pdf", ".xlsx", ".xls"],
    excel: [".xlsx", ".xls"],
    audio: [".webm", ".ogg", ".mp4", ".wav", ".mp3", ".m4a"]
  };
  if (!ext || !allowedExtsByFolder[subFolder].includes(ext)) {
    throw new ValidationError(400, `\u067E\u0633\u0648\u0646\u062F \u0641\u0627\u06CC\u0644 (${ext || "\u0628\u062F\u0648\u0646 \u067E\u0633\u0648\u0646\u062F"}) \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u0628\u062E\u0634 \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A.`);
  }
  if (!sigToExts[detectedSig]?.includes(ext)) {
    throw new ValidationError(400, "\u0645\u062D\u062A\u0648\u0627\u06CC \u0628\u0627\u06CC\u0646\u0631\u06CC \u0648\u0627\u0642\u0639\u06CC \u0641\u0627\u06CC\u0644 \u0628\u0627 \u067E\u0633\u0648\u0646\u062F \u0627\u0639\u0644\u0627\u0645\u200C\u0634\u062F\u0647 \u0645\u0637\u0627\u0628\u0642\u062A \u0646\u062F\u0627\u0631\u062F.");
  }
  const safeBase = import_path3.default.basename(rawName, import_path3.default.extname(rawName)).replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, "_").slice(0, 40) || "file";
  const fileName = `${Date.now()}_${import_crypto4.default.randomBytes(4).toString("hex")}_${safeBase}${ext}`;
  const baseMediaDir = process.env.PRIVATE_MEDIA_DIR ? import_path3.default.resolve(process.cwd(), process.env.PRIVATE_MEDIA_DIR) : import_path3.default.resolve(process.cwd(), ".data/private_media");
  const targetDir = import_path3.default.resolve(baseMediaDir, subFolder);
  import_fs3.default.mkdirSync(targetDir, { recursive: true, mode: 448 });
  const fullPath = import_path3.default.join(targetDir, fileName);
  import_fs3.default.writeFileSync(fullPath, buffer, { mode: 384 });
  return {
    publicUrl: `/assets/media/${subFolder}/${fileName}`,
    sizeBytes: buffer.length
  };
}
function extractSqlDateString(val, fallbackShamsi) {
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val.trim())) {
    return val.trim().slice(0, 10);
  }
  if (typeof fallbackShamsi === "string" && isValidShamsiDate(fallbackShamsi.trim())) {
    return shamsiToGregorian(normalizeShamsiDate(fallbackShamsi.trim()));
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const tehranMs = val.getTime() + (3 * 60 + 30) * 60 * 1e3;
    return new Date(tehranMs).toISOString().slice(0, 10);
  }
  return String(val || "").slice(0, 10);
}
function mapRowToAttendanceLog(row) {
  const workDate = extractSqlDateString(row.work_date, row.shamsi_date);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    work_date: workDate,
    shamsi_date: String(row.shamsi_date),
    event_type: row.event_type,
    recorded_at: row.recorded_at ? new Date(row.recorded_at).toISOString() : "",
    recorded_time: String(row.recorded_time),
    note: row.note ? String(row.note) : null,
    is_manual_override: Boolean(row.is_manual_override),
    modified_by_user_id: row.modified_by_user_id ? Number(row.modified_by_user_id) : null,
    modification_reason: row.modification_reason ? String(row.modification_reason) : null,
    is_deleted: Boolean(row.is_deleted),
    late_status: row.late_status || "NONE",
    late_reason: row.late_reason ? String(row.late_reason) : null,
    manager_late_note: row.manager_late_note ? String(row.manager_late_note) : null,
    custom_deduction_toman: row.custom_deduction_toman !== null && row.custom_deduction_toman !== void 0 ? Number(row.custom_deduction_toman) : null,
    late_reviewed_by_user_id: row.late_reviewed_by_user_id ? Number(row.late_reviewed_by_user_id) : null,
    late_reviewed_at: row.late_reviewed_at ? new Date(row.late_reviewed_at).toISOString() : null,
    is_late_seen_by_worker: row.is_late_seen_by_worker !== void 0 && row.is_late_seen_by_worker !== null ? Boolean(row.is_late_seen_by_worker) : true,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : ""
  };
}
function mapRowToFinancialTx(row) {
  const txDate = extractSqlDateString(row.tx_date, row.shamsi_date);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    created_by_user_id: Number(row.created_by_user_id),
    creator_role: row.creator_role,
    creator_name: row.creator_name,
    amount_toman: Number(row.amount_toman),
    tx_type: row.tx_type,
    tx_date: txDate,
    shamsi_date: String(row.shamsi_date),
    description: String(row.description),
    receipt_file_url: row.receipt_file_url ? String(row.receipt_file_url) : null,
    receipt_file_name: row.receipt_file_name ? String(row.receipt_file_name) : null,
    status: row.status,
    is_seen_by_manager: Boolean(row.is_seen_by_manager),
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    manager_note: row.manager_note ? String(row.manager_note) : null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : ""
  };
}
function mapRowToHistoricalWork(row) {
  const workDate = extractSqlDateString(row.work_date, row.shamsi_date);
  let parsedRows = [];
  if (row.parsed_rows_json) {
    try {
      parsedRows = typeof row.parsed_rows_json === "string" ? JSON.parse(row.parsed_rows_json) : row.parsed_rows_json;
    } catch {
      parsedRows = [];
    }
  }
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    shamsi_date: String(row.shamsi_date),
    work_date: workDate,
    title: String(row.title),
    work_days_count: Number(row.work_days_count),
    net_work_minutes: Number(row.net_work_minutes),
    overtime_minutes: Number(row.overtime_minutes),
    note: row.note ? String(row.note) : null,
    status: row.status || "APPROVED",
    excel_file_url: row.excel_file_url ? String(row.excel_file_url) : null,
    excel_file_name: row.excel_file_name ? String(row.excel_file_name) : null,
    parsed_rows: parsedRows,
    is_seen_by_manager: Boolean(row.is_seen_by_manager),
    created_by_user_id: Number(row.created_by_user_id),
    creator_role: row.creator_role,
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : ""
  };
}
function inferHistoricalCheckInOut(netMins, otMins, note, explicitIn, explicitOut) {
  if (explicitIn && explicitOut) {
    return { firstIn: explicitIn, lastOut: explicitOut };
  }
  const noteStr = note || "";
  if (noteStr.includes("\u06F0\u06F8:\u06F0\u06F0") && noteStr.includes("\u06F1\u06F4:\u06F3\u06F0")) {
    return { firstIn: "08:00", lastOut: "14:30" };
  }
  const startMinutes = netMins > 0 && netMins <= 480 ? 7 * 60 + (480 - netMins) : 7 * 60;
  const inH = Math.floor(startMinutes / 60);
  const inM = startMinutes % 60;
  const firstIn = explicitIn || `${String(inH).padStart(2, "0")}:${String(inM).padStart(2, "0")}`;
  const endMinutes = 15 * 60 + Math.max(0, otMins);
  const outH = Math.floor(endMinutes / 60);
  const outM = endMinutes % 60;
  const lastOut = explicitOut || `${String(outH).padStart(2, "0")}:${String(outM).padStart(2, "0")}`;
  return { firstIn, lastOut };
}
function mergeApprovedHistoricalIntoDailySummaries(dailySummaries, historicalRecords, fromShamsi = null, toShamsi = null) {
  const byShamsi = /* @__PURE__ */ new Map();
  for (const s of dailySummaries) {
    byShamsi.set(normalizeShamsiDate(s.shamsi_date), s);
  }
  for (const rec of historicalRecords) {
    if (rec.status !== "APPROVED") continue;
    if (rec.parsed_rows && rec.parsed_rows.length > 0) {
      for (const row of rec.parsed_rows) {
        if (!row.shamsi_date || !isValidShamsiDate(row.shamsi_date)) continue;
        const normShamsi = normalizeShamsiDate(row.shamsi_date);
        if (fromShamsi && normShamsi < fromShamsi) continue;
        if (toShamsi && normShamsi > toShamsi) continue;
        if (byShamsi.has(normShamsi)) continue;
        const workDate = shamsiToGregorian(normShamsi);
        const dayName = getShamsiDayOfWeekName(normShamsi);
        const isMission = Boolean(row.note && row.note.includes("\u0645\u0623\u0645\u0648\u0631\u06CC\u062A"));
        const { firstIn, lastOut } = inferHistoricalCheckInOut(
          row.net_work_minutes,
          row.overtime_minutes,
          row.note,
          row.check_in,
          row.check_out
        );
        byShamsi.set(normShamsi, {
          work_date: workDate,
          shamsi_date: normShamsi,
          day_name: dayName,
          is_holiday_or_friday: dayName === "\u062C\u0645\u0639\u0647",
          is_working_day: dayName !== "\u062C\u0645\u0639\u0647",
          logs: [],
          first_in_time: firstIn,
          last_out_time: lastOut,
          is_incomplete: false,
          is_late: row.net_work_minutes > 0 && row.net_work_minutes < 480 && dayName !== "\u062C\u0645\u0639\u0647",
          late_minutes: row.net_work_minutes > 0 && row.net_work_minutes < 480 && dayName !== "\u062C\u0645\u0639\u0647" ? 480 - row.net_work_minutes : 0,
          gross_presence_minutes: row.net_work_minutes + row.overtime_minutes,
          mission_minutes: isMission ? 60 : 0,
          break_deducted_minutes: 0,
          net_work_minutes: row.net_work_minutes,
          provisional_work_minutes: row.net_work_minutes,
          overtime_minutes: row.overtime_minutes,
          status_label: row.note || row.title || "\u062B\u0628\u062A\u200C\u0634\u062F\u0647 \u062F\u0631 \u0633\u0648\u0627\u0628\u0642 \u06A9\u0627\u0631\u06A9\u0631\u062F"
        });
      }
    } else if (rec.work_days_count === 1 && isValidShamsiDate(rec.shamsi_date)) {
      const normShamsi = normalizeShamsiDate(rec.shamsi_date);
      if (fromShamsi && normShamsi < fromShamsi) continue;
      if (toShamsi && normShamsi > toShamsi) continue;
      if (byShamsi.has(normShamsi)) continue;
      const workDate = shamsiToGregorian(normShamsi);
      const dayName = getShamsiDayOfWeekName(normShamsi);
      const { firstIn, lastOut } = inferHistoricalCheckInOut(
        rec.net_work_minutes,
        rec.overtime_minutes,
        rec.note
      );
      byShamsi.set(normShamsi, {
        work_date: workDate,
        shamsi_date: normShamsi,
        day_name: dayName,
        is_holiday_or_friday: dayName === "\u062C\u0645\u0639\u0647",
        is_working_day: dayName !== "\u062C\u0645\u0639\u0647",
        logs: [],
        first_in_time: firstIn,
        last_out_time: lastOut,
        is_incomplete: false,
        is_late: false,
        late_minutes: 0,
        gross_presence_minutes: rec.net_work_minutes + rec.overtime_minutes,
        mission_minutes: 0,
        break_deducted_minutes: 0,
        net_work_minutes: rec.net_work_minutes,
        provisional_work_minutes: rec.net_work_minutes,
        overtime_minutes: rec.overtime_minutes,
        status_label: rec.note || rec.title
      });
    }
  }
  return Array.from(byShamsi.values()).sort(
    (a, b) => b.work_date.localeCompare(a.work_date)
  );
}
function mapRowToLeaveRequest(row) {
  const workDate = extractSqlDateString(row.work_date, row.shamsi_date);
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    shamsi_date: String(row.shamsi_date),
    work_date: workDate,
    leave_type: row.leave_type || "DAILY",
    start_time: row.start_time ? String(row.start_time) : null,
    end_time: row.end_time ? String(row.end_time) : null,
    duration_minutes: Number(row.duration_minutes || 480),
    reason: String(row.reason || ""),
    status: row.status || "PENDING",
    is_seen_by_manager: Boolean(row.is_seen_by_manager),
    manager_note: row.manager_note ? String(row.manager_note) : null,
    reviewed_by_user_id: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewed_at: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : ""
  };
}
function mapRowToWorkTask(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    created_by_user_id: Number(row.created_by_user_id),
    shamsi_date: String(row.shamsi_date),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    is_completed: Boolean(row.is_completed),
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    added_to_report: Boolean(row.added_to_report),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : ""
  };
}
async function getWorkerInfo(pool2) {
  const [rows] = await pool2.execute(
    "SELECT id, full_name, avatar_url, collaboration_start_shamsi, phone_number FROM users WHERE role = 'worker' LIMIT 1"
  );
  if (rows.length === 0) {
    throw new Error("\u062D\u0633\u0627\u0628 \u067E\u0631\u0633\u0646\u0644 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F");
  }
  const r = rows[0];
  return {
    id: Number(r.id),
    full_name: String(r.full_name || "\u0627\u0645\u06CC\u062F \u0645\u06CC\u062B\u0645\u06CC"),
    avatar_url: r.avatar_url ? String(r.avatar_url) : null,
    collaboration_start_shamsi: r.collaboration_start_shamsi ? String(r.collaboration_start_shamsi) : "1405/06/15",
    phone_number: r.phone_number ? String(r.phone_number) : null
  };
}
async function getWorkerUserId(pool2) {
  const info = await getWorkerInfo(pool2);
  return info.id;
}
async function resolveTargetWorkerId(pool2, req, res) {
  const rawTarget = req.query?.userId ?? req.query?.user_id ?? req.body?.userId ?? req.body?.user_id;
  if (req.user.role !== "manager") {
    if (rawTarget !== void 0 && rawTarget !== null && String(rawTarget).trim() !== "" && Number(rawTarget) !== req.user.id) {
      res.status(403).json({
        ok: false,
        code: "FORBIDDEN_USER_ACCESS",
        message: "\u0634\u0645\u0627 \u0645\u062C\u0648\u0632 \u062F\u0633\u062A\u0631\u0633\u06CC \u06CC\u0627 \u062A\u063A\u06CC\u06CC\u0631 \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u06A9\u0627\u0631\u0628\u0631 \u062F\u06CC\u06AF\u0631 \u0631\u0627 \u0646\u062F\u0627\u0631\u06CC\u062F."
      });
      return null;
    }
    return req.user.id;
  }
  if (rawTarget !== void 0 && rawTarget !== null && String(rawTarget).trim() !== "") {
    const parsedId = Number(rawTarget);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
      return null;
    }
    return parsedId;
  }
  return getWorkerUserId(pool2);
}
apiRouter.get("/health", async (_req, res) => {
  const status = await checkDatabaseConnection();
  if (!status.connected) {
    res.status(503).json({
      ok: false,
      dbConnected: false,
      message: status.message
    });
    return;
  }
  try {
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    res.json({
      ok: true,
      dbConnected: true,
      serverTime: nowInfo,
      bannerBgUrl: settings.banner_bg_url || "/assets/media/banner-bg.svg"
    });
  } catch {
    const nowInfo = getNowInTimezone("Asia/Tehran");
    res.json({
      ok: true,
      dbConnected: true,
      serverTime: nowInfo,
      bannerBgUrl: "/assets/media/banner-bg.svg"
    });
  }
});
apiRouter.post("/auth/login", async (req, res) => {
  try {
    const username = toEnglishDigits(String(req.body?.username || "")).trim().toLowerCase();
    const password = String(req.body?.password || "");
    const clientIp = req.ip || "unknown";
    if (!username || !password) {
      res.status(400).json({
        ok: false,
        message: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0648 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A."
      });
      return;
    }
    const rateCheck = checkLoginRateLimit(clientIp, username);
    if (!rateCheck.allowed) {
      res.setHeader("Retry-After", String(rateCheck.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        code: "TOO_MANY_ATTEMPTS",
        message: `\u062A\u0639\u062F\u0627\u062F \u062A\u0644\u0627\u0634\u200C\u0647\u0627\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B ${rateCheck.retryAfterSeconds} \u062B\u0627\u0646\u06CC\u0647 \u062F\u06CC\u06AF\u0631 \u0645\u062C\u062F\u062F\u0627\u064B \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.`
      });
      return;
    }
    if (process.env.NODE_ENV === "production" && FORBIDDEN_DEFAULT_PASSWORDS.has(password)) {
      await recordFailedLoginAttempt(clientIp, username);
      res.status(403).json({
        ok: false,
        code: "DEFAULT_PASSWORD_FORBIDDEN",
        message: "\u0648\u0631\u0648\u062F \u0628\u0627 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u062F\u0631 \u0645\u062D\u06CC\u0637 \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC (Production) \u0645\u0645\u0646\u0648\u0639 \u0627\u0633\u062A."
      });
      return;
    }
    const pool2 = getPool();
    const [rows] = await pool2.execute(
      "SELECT id, username, full_name, role, avatar_url, collaboration_start_shamsi, phone_number, biometric_token_hash, password_hash, must_change_password, is_active, last_login_at FROM users WHERE LOWER(username) = ? LIMIT 1",
      [username]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      const failState = await recordFailedLoginAttempt(clientIp, username);
      if (failState.locked) {
        res.status(429).json({
          ok: false,
          code: "TOO_MANY_ATTEMPTS",
          message: "\u062D\u0633\u0627\u0628 \u0645\u0648\u0642\u062A\u0627\u064B \u0628\u0647 \u062F\u0644\u06CC\u0644 \u062A\u0644\u0627\u0634\u200C\u0647\u0627\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0645\u062A\u0648\u0627\u0644\u06CC \u0642\u0641\u0644 \u0634\u062F. \u0644\u0637\u0641\u0627\u064B \u06F1\u06F5 \u062F\u0642\u06CC\u0642\u0647 \u062F\u06CC\u06AF\u0631 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F."
        });
        return;
      }
      res.status(401).json({
        ok: false,
        message: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u06CC\u0627 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0634\u062A\u0628\u0627\u0647 \u0627\u0633\u062A."
      });
      return;
    }
    const userRow = rows[0];
    let match = await import_bcryptjs2.default.compare(password, String(userRow.password_hash));
    if (!match) {
      const normalizedPassword = toEnglishDigits(password).trim();
      if (normalizedPassword !== password) {
        match = await import_bcryptjs2.default.compare(normalizedPassword, String(userRow.password_hash));
      }
    }
    if (!match) {
      const failState = await recordFailedLoginAttempt(clientIp, username);
      await recordAuditLog({
        actorUserId: Number(userRow.id),
        actionType: "LOGIN_FAILED",
        targetEntity: "users",
        targetId: Number(userRow.id),
        ipAddress: req.ip || null
      });
      if (failState.locked) {
        res.status(429).json({
          ok: false,
          code: "TOO_MANY_ATTEMPTS",
          message: "\u062D\u0633\u0627\u0628 \u0645\u0648\u0642\u062A\u0627\u064B \u0628\u0647 \u062F\u0644\u06CC\u0644 \u062A\u0644\u0627\u0634\u200C\u0647\u0627\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0645\u062A\u0648\u0627\u0644\u06CC \u0642\u0641\u0644 \u0634\u062F. \u0644\u0637\u0641\u0627\u064B \u06F1\u06F5 \u062F\u0642\u06CC\u0642\u0647 \u062F\u06CC\u06AF\u0631 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F."
        });
        return;
      }
      res.status(401).json({
        ok: false,
        message: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u06CC\u0627 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0634\u062A\u0628\u0627\u0647 \u0627\u0633\u062A."
      });
      return;
    }
    clearLoginAttempts(clientIp, username);
    await pool2.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [userRow.id]);
    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      Number(userRow.id),
      req.ip || null,
      req.headers["user-agent"] || null
    );
    setSessionCookie(res, rawToken, expiresAt);
    await recordAuditLog({
      actorUserId: Number(userRow.id),
      actionType: "LOGIN_SUCCESS",
      targetEntity: "users",
      targetId: Number(userRow.id),
      ipAddress: req.ip || null
    });
    const mustChangePassword = Boolean(userRow.must_change_password) || FORBIDDEN_DEFAULT_PASSWORDS.has(password);
    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      requirePasswordChange: mustChangePassword,
      user: {
        id: Number(userRow.id),
        username: String(userRow.username),
        full_name: String(userRow.full_name),
        role: userRow.role,
        avatar_url: userRow.avatar_url ? String(userRow.avatar_url) : null,
        collaboration_start_shamsi: userRow.collaboration_start_shamsi ? String(userRow.collaboration_start_shamsi) : "1405/06/15",
        phone_number: userRow.phone_number ? String(userRow.phone_number) : null,
        biometric_enabled: Boolean(userRow.biometric_token_hash),
        must_change_password: mustChangePassword,
        last_login_at: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/auth/biometric/register", requireAuth, async (req, res) => {
  try {
    const credentialId = String(req.body?.credential_id || "").trim();
    if (!credentialId) {
      res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u0628\u06CC\u0648\u0645\u062A\u0631\u06CC\u06A9 \u062F\u0633\u062A\u06AF\u0627\u0647 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
      return;
    }
    const rawBioToken = import_crypto4.default.randomBytes(32).toString("hex");
    const bioTokenHash = hashSessionToken(rawBioToken);
    const pool2 = getPool();
    await pool2.execute(
      "UPDATE users SET biometric_credential_id = ?, biometric_token_hash = ? WHERE id = ?",
      [credentialId, bioTokenHash, req.user.id]
    );
    res.json({
      ok: true,
      biometric_token: rawBioToken,
      credential_id: credentialId,
      username: req.user.username,
      full_name: req.user.full_name,
      role: req.user.role,
      message: "\u0648\u0631\u0648\u062F \u0633\u0631\u06CC\u0639 \u0628\u0627 \u0627\u062B\u0631 \u0627\u0646\u06AF\u0634\u062A / \u062A\u0634\u062E\u06CC\u0635 \u0686\u0647\u0631\u0647 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u062F\u0633\u062A\u06AF\u0627\u0647 \u0641\u0639\u0627\u0644 \u0634\u062F."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.delete("/auth/biometric", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    await pool2.execute(
      "UPDATE users SET biometric_credential_id = NULL, biometric_token_hash = NULL WHERE id = ?",
      [req.user.id]
    );
    res.json({
      ok: true,
      message: "\u0648\u0631\u0648\u062F \u0628\u0627 \u0627\u062B\u0631 \u0627\u0646\u06AF\u0634\u062A / \u062A\u0634\u062E\u06CC\u0635 \u0686\u0647\u0631\u0647 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0634\u062F."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/auth/biometric/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const credentialId = String(req.body?.credential_id || "").trim();
    const biometricToken = String(req.body?.biometric_token || "").trim();
    const clientIp = req.ip || "unknown";
    if (!username || !credentialId || !biometricToken) {
      res.status(400).json({ ok: false, message: "\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0648\u0631\u0648\u062F \u0628\u06CC\u0648\u0645\u062A\u0631\u06CC\u06A9 \u0646\u0627\u0642\u0635 \u0627\u0633\u062A." });
      return;
    }
    const rateCheck = checkLoginRateLimit(clientIp, username);
    if (!rateCheck.allowed) {
      res.status(429).json({
        ok: false,
        code: "TOO_MANY_ATTEMPTS",
        message: "\u062A\u0639\u062F\u0627\u062F \u062A\u0644\u0627\u0634\u200C\u0647\u0627\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0628\u0639\u062F\u0627\u064B \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F."
      });
      return;
    }
    const pool2 = getPool();
    const [rows] = await pool2.execute(
      "SELECT id, username, full_name, role, avatar_url, collaboration_start_shamsi, phone_number, biometric_credential_id, biometric_token_hash, must_change_password, is_active FROM users WHERE username = ? LIMIT 1",
      [username]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      await recordFailedLoginAttempt(clientIp, username);
      res.status(401).json({ ok: false, message: "\u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
      return;
    }
    const userRow = rows[0];
    const expectedHash = hashSessionToken(biometricToken);
    if (!userRow.biometric_token_hash || String(userRow.biometric_credential_id) !== credentialId || String(userRow.biometric_token_hash) !== expectedHash) {
      await recordFailedLoginAttempt(clientIp, username);
      res.status(401).json({
        ok: false,
        message: "\u06A9\u0644\u06CC\u062F \u0627\u062B\u0631 \u0627\u0646\u06AF\u0634\u062A \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u06CC\u06A9 \u0628\u0627\u0631 \u0628\u0627 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0648\u0627\u0631\u062F \u0634\u0648\u06CC\u062F \u0648 \u0645\u062C\u062F\u062F\u0627\u064B \u0641\u0639\u0627\u0644 \u06A9\u0646\u06CC\u062F."
      });
      return;
    }
    clearLoginAttempts(clientIp, username);
    await pool2.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [userRow.id]);
    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      Number(userRow.id),
      req.ip || null,
      req.headers["user-agent"] || null
    );
    setSessionCookie(res, rawToken, expiresAt);
    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      user: {
        id: Number(userRow.id),
        username: String(userRow.username),
        full_name: String(userRow.full_name),
        role: userRow.role,
        avatar_url: userRow.avatar_url ? String(userRow.avatar_url) : null,
        collaboration_start_shamsi: userRow.collaboration_start_shamsi ? String(userRow.collaboration_start_shamsi) : "1405/06/15",
        phone_number: userRow.phone_number ? String(userRow.phone_number) : null,
        biometric_enabled: true,
        must_change_password: Boolean(userRow.must_change_password),
        last_login_at: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/auth/logout", async (req, res) => {
  try {
    const session = await getSessionUser(req);
    if (session) {
      const pool2 = getPool();
      await pool2.execute("DELETE FROM user_sessions WHERE token_hash = ?", [session.tokenHash]);
    }
    clearSessionCookie(res);
    res.json({ ok: true, message: "\u062E\u0631\u0648\u062C \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F." });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const csrfToken = req.rawSessionToken ? generateCsrfToken(req.rawSessionToken) : void 0;
    res.json({
      ok: true,
      user: req.user,
      csrfToken,
      serverTime: nowInfo,
      settings: sanitizeSettingsForRole(settings, req.user.role)
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.put("/auth/avatar", requireAuth, async (req, res) => {
  try {
    const targetRole = req.user.role;
    const avatarBase64 = req.body?.avatar_base64 ? String(req.body.avatar_base64) : null;
    const fileName = req.body?.file_name ? String(req.body.file_name) : "avatar.png";
    const pool2 = getPool();
    let newAvatarUrl = null;
    if (avatarBase64 && avatarBase64.trim() !== "") {
      if (avatarBase64.length > 4e6) {
        res.status(400).json({
          ok: false,
          message: "\u062D\u062C\u0645 \u062A\u0635\u0648\u06CC\u0631 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0646\u0628\u0627\u06CC\u062F \u0628\u06CC\u0634\u062A\u0631 \u0627\u0632 \u06F2.\u06F5 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A \u0628\u0627\u0634\u062F."
        });
        return;
      }
      const saved = saveBase64MediaFile("avatars", fileName, avatarBase64);
      newAvatarUrl = saved.publicUrl;
    }
    await pool2.execute("UPDATE users SET avatar_url = ? WHERE id = ?", [newAvatarUrl, req.user.id]);
    res.json({
      ok: true,
      avatar_url: newAvatarUrl,
      target_role: targetRole,
      message: newAvatarUrl ? "\u062A\u0635\u0648\u06CC\u0631 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0630\u062E\u06CC\u0631\u0647 \u0634\u062F." : "\u062A\u0635\u0648\u06CC\u0631 \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0628\u0647 \u062D\u0627\u0644\u062A \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u0628\u0627\u0632\u06AF\u0631\u062F\u0627\u0646\u06CC \u0634\u062F."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || req.body?.current_password || "");
    const newPassword = String(req.body?.newPassword || req.body?.new_password || "");
    if (!currentPassword || !newPassword) {
      res.status(400).json({
        ok: false,
        message: "\u0648\u0627\u0631\u062F \u06A9\u0631\u062F\u0646 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0641\u0639\u0644\u06CC \u0648 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A."
      });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({
        ok: false,
        message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F8 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F."
      });
      return;
    }
    if (FORBIDDEN_DEFAULT_PASSWORDS.has(newPassword) || newPassword === currentPassword) {
      res.status(400).json({
        ok: false,
        message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0646\u0628\u0627\u06CC\u062F \u0628\u0627 \u0631\u0645\u0632 \u0641\u0639\u0644\u06CC \u06CC\u0627 \u0631\u0645\u0632\u0647\u0627\u06CC \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u06CC\u06A9\u0633\u0627\u0646 \u0628\u0627\u0634\u062F."
      });
      return;
    }
    const pool2 = getPool();
    const userId = req.user.id;
    const [rows] = await pool2.execute(
      "SELECT password_hash FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (rows.length === 0) {
      res.status(404).json({ ok: false, message: "\u06A9\u0627\u0631\u0628\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
      return;
    }
    const isMatch = await import_bcryptjs2.default.compare(currentPassword, String(rows[0].password_hash));
    if (!isMatch) {
      res.status(400).json({
        ok: false,
        message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0641\u0639\u0644\u06CC \u0646\u0627\u062F\u0631\u0633\u062A \u0627\u0633\u062A."
      });
      return;
    }
    const newHash = await import_bcryptjs2.default.hash(newPassword, 10);
    await pool2.execute(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
      [newHash, userId]
    );
    await pool2.execute("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      userId,
      req.ip || null,
      req.headers["user-agent"] || null
    );
    setSessionCookie(res, rawToken, expiresAt);
    await recordAuditLog({
      actorUserId: userId,
      actionType: "PASSWORD_CHANGE",
      targetEntity: "users",
      targetId: userId,
      ipAddress: req.ip || null
    });
    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062A\u063A\u06CC\u06CC\u0631 \u06CC\u0627\u0641\u062A \u0648 \u0646\u0634\u0633\u062A\u200C\u0647\u0627\u06CC \u0642\u0628\u0644\u06CC \u0628\u06CC\u200C\u0627\u0639\u062A\u0628\u0627\u0631 \u0634\u062F\u0646\u062F."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
var passwordResetOtpStore = /* @__PURE__ */ new Map();
function normalizeIranMobile(raw) {
  const clean = toEnglishDigits(String(raw || "")).replace(/\s+/g, "").trim();
  if (/^\+989\d{9}$/.test(clean)) return `0${clean.slice(3)}`;
  if (/^989\d{9}$/.test(clean)) return `0${clean.slice(2)}`;
  if (/^9\d{9}$/.test(clean)) return `0${clean}`;
  if (/^09\d{9}$/.test(clean)) return clean;
  return "";
}
function maskMobileNumber(phone) {
  if (phone.length < 10) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}
apiRouter.put("/auth/phone", requireAuth, async (req, res) => {
  try {
    const rawPhone = String(req.body?.phone_number || "").trim();
    const normalized = rawPhone ? normalizeIranMobile(rawPhone) : "";
    if (rawPhone && !normalized) {
      res.status(400).json({
        ok: false,
        message: "\u0641\u0631\u0645\u062A \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A (\u0645\u062B\u0627\u0644: 09123456789)."
      });
      return;
    }
    const pool2 = getPool();
    await pool2.execute("UPDATE users SET phone_number = ? WHERE id = ?", [
      normalized || null,
      req.user.id
    ]);
    if (req.user.role === "worker") {
      await pool2.execute("UPDATE system_settings SET worker_phone_number = ?", [normalized]);
    }
    res.json({
      ok: true,
      phone_number: normalized || null,
      message: normalized ? "\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u0634\u0645\u0627 \u0628\u0631\u0627\u06CC \u062F\u0631\u06CC\u0627\u0641\u062A \u06A9\u062F \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0630\u062E\u06CC\u0631\u0647 \u0634\u062F." : "\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u062D\u0630\u0641 \u0634\u062F."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/auth/forgot-password/request-otp", async (req, res) => {
  try {
    const username = toEnglishDigits(String(req.body?.username || "")).trim().toLowerCase();
    if (!username) {
      res.status(400).json({
        ok: false,
        message: "\u0644\u0637\u0641\u0627\u064B \u0627\u0628\u062A\u062F\u0627 \u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC (\u0645\u062F\u06CC\u0631\u06CC\u062A \u06CC\u0627 \u067E\u0631\u0633\u0646\u0644) \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06CC\u0627 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F."
      });
      return;
    }
    const pool2 = getPool();
    const [rows] = await pool2.execute(
      "SELECT id, username, full_name, role, phone_number, is_active FROM users WHERE LOWER(username) = ? LIMIT 1",
      [username]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      res.status(404).json({
        ok: false,
        message: "\u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F."
      });
      return;
    }
    const userRow = rows[0];
    const userKey = String(userRow.username).toLowerCase();
    const existingOtp = passwordResetOtpStore.get(userKey);
    const nowMs = Date.now();
    if (existingOtp && nowMs - existingOtp.lastSentAtMs < 6e4) {
      const waitSec = Math.ceil((6e4 - (nowMs - existingOtp.lastSentAtMs)) / 1e3);
      res.status(429).json({
        ok: false,
        message: `\u06A9\u062F \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0628\u0647 \u062A\u0627\u0632\u06AF\u06CC \u0627\u0631\u0633\u0627\u0644 \u0634\u062F\u0647 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B ${toPersianDigits(waitSec)} \u062B\u0627\u0646\u06CC\u0647 \u062F\u06CC\u06AF\u0631 \u0645\u062C\u062F\u062F\u0627\u064B \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.`
      });
      return;
    }
    const settings = await getSystemSettingsFromDb();
    let targetPhone = normalizeIranMobile(userRow.phone_number);
    if (!targetPhone) {
      if (userRow.role === "worker") {
        targetPhone = normalizeIranMobile(settings.worker_phone_number);
      } else if (userRow.role === "manager") {
        targetPhone = normalizeIranMobile(settings.melipayamak_username);
      }
    }
    if (!targetPhone) {
      res.status(400).json({
        ok: false,
        message: userRow.role === "worker" ? "\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u067E\u0631\u0633\u0646\u0644 \u062F\u0631 \u0633\u0627\u0645\u0627\u0646\u0647 \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0627\u0632 \u0645\u062F\u06CC\u0631 \u0645\u062C\u0645\u0648\u0639\u0647 (\u0645\u062C\u06CC\u062F \u0646\u0648\u0631\u0627\u06CC\u06CC) \u0628\u062E\u0648\u0627\u0647\u06CC\u062F \u0627\u0632 \u0628\u062E\u0634 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u062D\u0633\u0627\u0628\u060C \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0634\u0645\u0627 \u0631\u0627 \u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06CC \u06A9\u0646\u062F." : "\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u0645\u062F\u06CC\u0631\u06CC\u062A \u062F\u0631 \u0633\u0627\u0645\u0627\u0646\u0647 \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u067E\u0633 \u0627\u0632 \u0648\u0631\u0648\u062F \u062F\u0631 \u0628\u062E\u0634 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u062D\u0633\u0627\u0628\u060C \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u062E\u0648\u062F \u0631\u0627 \u062B\u0628\u062A \u0646\u0645\u0627\u06CC\u06CC\u062F."
      });
      return;
    }
    if (!settings.melipayamak_username || !settings.melipayamak_password) {
      res.status(400).json({
        ok: false,
        message: userRow.role === "worker" ? "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u067E\u06CC\u0627\u0645\u06A9 (\u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9) \u0647\u0646\u0648\u0632 \u062A\u06A9\u0645\u06CC\u0644 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A. \u0645\u062F\u06CC\u0631 \u0645\u062C\u0645\u0648\u0639\u0647 (\u0645\u062C\u06CC\u062F \u0646\u0648\u0631\u0627\u06CC\u06CC) \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u062F \u0627\u0632 \u067E\u0646\u0644 \u0645\u062F\u06CC\u0631\u06CC\u062A \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0634\u0645\u0627 \u0631\u0627 \u0645\u0633\u062A\u0642\u06CC\u0645\u0627\u064B \u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06CC \u06A9\u0646\u062F." : "\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u0645\u0644\u06CC\u200C\u067E\u06CC\u0627\u0645\u06A9 \u062F\u0631 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0633\u0627\u0645\u0627\u0646\u0647 \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A."
      });
      return;
    }
    const otpCode = String(import_crypto4.default.randomInt(1e5, 999999));
    const smsText = `\u0633\u0627\u0645\u0627\u0646\u0647 Mgammon
\u06A9\u062F \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062D\u0633\u0627\u0628 ${userRow.full_name}: ${otpCode}
\u0627\u0639\u062A\u0628\u0627\u0631: \u06F2 \u062F\u0642\u06CC\u0642\u0647`;
    const smsResult = await sendMelipayamakSms(settings, targetPhone, smsText);
    if (!smsResult.sent) {
      res.status(502).json({
        ok: false,
        message: `\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645\u06A9 \u06A9\u062F \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC: ${smsResult.statusMessage}`
      });
      return;
    }
    passwordResetOtpStore.set(userKey, {
      codeHash: hashSessionToken(otpCode),
      expiresAtMs: nowMs + 2 * 60 * 1e3,
      attempts: 0,
      lastSentAtMs: nowMs
    });
    await recordAuditLog({
      actorUserId: Number(userRow.id),
      actionType: "PASSWORD_RESET_OTP_SENT",
      targetEntity: "users",
      targetId: Number(userRow.id),
      ipAddress: req.ip || null
    });
    res.json({
      ok: true,
      maskedPhone: toPersianDigits(maskMobileNumber(targetPhone)),
      expiresInSeconds: 120,
      message: `\u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u06F6 \u0631\u0642\u0645\u06CC \u0628\u0647 \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 ${toPersianDigits(maskMobileNumber(targetPhone))} \u067E\u06CC\u0627\u0645\u06A9 \u0634\u062F.`
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/auth/forgot-password/reset", async (req, res) => {
  try {
    const username = toEnglishDigits(String(req.body?.username || "")).trim().toLowerCase();
    const otpCode = toEnglishDigits(String(req.body?.otpCode || req.body?.otp_code || "")).replace(/\D/g, "").trim();
    const newPassword = String(req.body?.newPassword || req.body?.new_password || "");
    if (!username || !otpCode || !newPassword) {
      res.status(400).json({
        ok: false,
        message: "\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC\u060C \u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u06F6 \u0631\u0642\u0645\u06CC \u0648 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A."
      });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({
        ok: false,
        message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F8 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F."
      });
      return;
    }
    const pool2 = getPool();
    const [rows] = await pool2.execute(
      "SELECT id, username, full_name, role, avatar_url, collaboration_start_shamsi, phone_number, biometric_token_hash, is_active FROM users WHERE LOWER(username) = ? LIMIT 1",
      [username]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      res.status(404).json({ ok: false, message: "\u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
      return;
    }
    const userRow = rows[0];
    const userKey = String(userRow.username).toLowerCase();
    const otpEntry = passwordResetOtpStore.get(userKey);
    if (!otpEntry || Date.now() > otpEntry.expiresAtMs) {
      passwordResetOtpStore.delete(userKey);
      res.status(400).json({
        ok: false,
        message: "\u06A9\u062F \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u06CC\u0627 \u0648\u062C\u0648\u062F \u0646\u062F\u0627\u0631\u062F. \u0644\u0637\u0641\u0627\u064B \u0645\u062C\u062F\u062F\u0627\u064B \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0627\u0631\u0633\u0627\u0644 \u06A9\u062F \u0628\u062F\u0647\u06CC\u062F."
      });
      return;
    }
    if (otpEntry.attempts >= 5) {
      passwordResetOtpStore.delete(userKey);
      res.status(429).json({
        ok: false,
        message: "\u062A\u0639\u062F\u0627\u062F \u062A\u0644\u0627\u0634\u200C\u0647\u0627\u06CC \u0627\u0634\u062A\u0628\u0627\u0647 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0628\u0648\u062F. \u0644\u0637\u0641\u0627\u064B \u06A9\u062F \u062C\u062F\u06CC\u062F \u062F\u0631\u06CC\u0627\u0641\u062A \u06A9\u0646\u06CC\u062F."
      });
      return;
    }
    if (hashSessionToken(otpCode) !== otpEntry.codeHash) {
      otpEntry.attempts += 1;
      res.status(400).json({
        ok: false,
        message: "\u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u0648\u0627\u0631\u062F\u0634\u062F\u0647 \u0635\u062D\u06CC\u062D \u0646\u06CC\u0633\u062A."
      });
      return;
    }
    passwordResetOtpStore.delete(userKey);
    const newHash = await import_bcryptjs2.default.hash(newPassword, 10);
    const userId = Number(userRow.id);
    await pool2.execute(
      "UPDATE users SET password_hash = ?, must_change_password = 0, last_login_at = NOW() WHERE id = ?",
      [newHash, userId]
    );
    await pool2.execute("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
    clearLoginAttempts(req.ip || "unknown", userKey);
    const { rawToken, csrfToken, expiresAt } = await createServerSession(
      userId,
      req.ip || null,
      req.headers["user-agent"] || null
    );
    setSessionCookie(res, rawToken, expiresAt);
    await recordAuditLog({
      actorUserId: userId,
      actionType: "PASSWORD_RESET_OTP_SUCCESS",
      targetEntity: "users",
      targetId: userId,
      ipAddress: req.ip || null
    });
    res.json({
      ok: true,
      token: rawToken,
      csrfToken,
      message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06CC \u0634\u062F.",
      user: {
        id: userId,
        username: String(userRow.username),
        full_name: String(userRow.full_name),
        role: userRow.role,
        avatar_url: userRow.avatar_url ? String(userRow.avatar_url) : null,
        collaboration_start_shamsi: userRow.collaboration_start_shamsi ? String(userRow.collaboration_start_shamsi) : "1405/06/15",
        phone_number: userRow.phone_number ? String(userRow.phone_number) : null,
        biometric_enabled: Boolean(userRow.biometric_token_hash),
        must_change_password: false,
        last_login_at: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post(
  "/auth/manager-reset-worker-password",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const newPassword = String(req.body?.newPassword || req.body?.new_password || "").trim();
      const sendSmsToWorker = Boolean(req.body?.sendSms);
      if (!newPassword || newPassword.length < 8) {
        res.status(400).json({
          ok: false,
          message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u067E\u0631\u0633\u0646\u0644 \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F8 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F."
        });
        return;
      }
      const pool2 = getPool();
      const [workerRows] = await pool2.execute(
        "SELECT id, username, full_name, phone_number FROM users WHERE role = 'worker' LIMIT 1"
      );
      if (workerRows.length === 0) {
        res.status(404).json({ ok: false, message: "\u062D\u0633\u0627\u0628 \u067E\u0631\u0633\u0646\u0644 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
        return;
      }
      const worker = workerRows[0];
      const workerId = Number(worker.id);
      const newHash = await import_bcryptjs2.default.hash(newPassword, 10);
      await pool2.execute(
        "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
        [newHash, workerId]
      );
      await pool2.execute("DELETE FROM user_sessions WHERE user_id = ?", [workerId]);
      await recordAuditLog({
        actorUserId: req.user.id,
        actionType: "MANAGER_RESET_WORKER_PASSWORD",
        targetEntity: "users",
        targetId: workerId,
        ipAddress: req.ip || null
      });
      let smsStatusNote = "";
      if (sendSmsToWorker) {
        const settings = await getSystemSettingsFromDb();
        const targetPhone = normalizeIranMobile(worker.phone_number) || normalizeIranMobile(settings.worker_phone_number);
        if (targetPhone && settings.melipayamak_username && settings.melipayamak_password) {
          const smsRes = await sendMelipayamakSms(
            settings,
            targetPhone,
            `\u0633\u0627\u0645\u0627\u0646\u0647 Mgammon
\u0647\u0645\u06A9\u0627\u0631 \u06AF\u0631\u0627\u0645\u06CC ${worker.full_name}\u060C \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0634\u0645\u0627 \u062A\u0648\u0633\u0637 \u0645\u062F\u06CC\u0631\u06CC\u062A \u062A\u0646\u0638\u06CC\u0645 \u0634\u062F:
\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC: ${worker.username}
\u0631\u0645\u0632 \u0639\u0628\u0648\u0631: ${newPassword}`
          );
          smsStatusNote = smsRes.sent ? " \u0648 \u0627\u0632 \u0637\u0631\u06CC\u0642 \u067E\u06CC\u0627\u0645\u06A9 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0634\u0627\u0646 \u0627\u0631\u0633\u0627\u0644 \u0634\u062F." : ` (\u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645\u06A9 \u0627\u0646\u062C\u0627\u0645 \u0646\u0634\u062F: ${smsRes.statusMessage})`;
        } else {
          smsStatusNote = " (\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u06CC\u0627 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u067E\u06CC\u0627\u0645\u06A9 \u0628\u0631\u0627\u06CC \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645\u06A9 \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A).";
        }
      }
      res.json({
        ok: true,
        message: `\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062D\u0633\u0627\u0628 \u067E\u0631\u0633\u0646\u0644 (${worker.full_name}) \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06CC \u0634\u062F${smsStatusNote}`
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
async function attachForgottenCheckoutWarning(pool2, workerId, liveState, settings, nowInfo) {
  const isThursday = nowInfo.dayOfWeek === 4;
  const shiftEndTime = isThursday ? settings.thursday_shift_end_time || "14:00" : settings.shift_end_time || "15:00";
  const nowMins = parseTimeToMinutes(nowInfo.timeHHMM);
  const endMins = parseTimeToMinutes(shiftEndTime);
  if (liveState.today_summary.logs.length > 0 && liveState.today_summary.is_incomplete && nowMins >= endMins + 15) {
    liveState.forgotten_checkout_warning = true;
    liveState.forgotten_checkout_message = `\u06CC\u0627\u062F\u0622\u0648\u0631: \u0633\u0627\u0639\u062A \u06A9\u0627\u0631\u06CC \u0627\u0645\u0631\u0648\u0632 (${toPersianDigits(shiftEndTime)}) \u0628\u0647 \u067E\u0627\u06CC\u0627\u0646 \u0631\u0633\u06CC\u062F\u0647 \u0627\u0645\u0627 \u0647\u0646\u0648\u0632 \xAB\u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631 (\u062E\u0631\u0648\u062C)\xBB \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.`;
    return;
  }
  const [recentRows] = await pool2.execute(
    `SELECT work_date, shamsi_date, event_type
     FROM attendance_logs
     WHERE user_id = ? AND work_date < ? AND is_deleted = 0
     ORDER BY work_date DESC, recorded_time ASC, id ASC
     LIMIT 60`,
    [workerId, nowInfo.workDate]
  );
  const byDate = /* @__PURE__ */ new Map();
  for (const r of recentRows) {
    const d = extractSqlDateString(r.work_date, r.shamsi_date);
    byDate.set(d, { shamsi: String(r.shamsi_date), lastType: String(r.event_type) });
  }
  for (const [, info] of byDate.entries()) {
    if (info.lastType !== "WORK_END") {
      liveState.forgotten_checkout_warning = true;
      liveState.forgotten_checkout_message = `\u06CC\u0627\u062F\u0622\u0648\u0631: \u062F\u0631 \u062A\u0627\u0631\u06CC\u062E ${toPersianDigits(info.shamsi)} \u062A\u0631\u062F\u062F \u0648\u0631\u0648\u062F \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0645\u0627 \xAB\u062E\u0631\u0648\u062C\xBB \u062B\u0628\u062A \u0646\u06AF\u0631\u062F\u06CC\u062F\u0647 \u0627\u0633\u062A.`;
      return;
    }
  }
}
apiRouter.get("/attendance/live-status", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const workerInfo = await getWorkerInfo(pool2);
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const [rows] = await pool2.execute(
      `SELECT * FROM attendance_logs
       WHERE user_id = ? AND work_date = ? AND is_deleted = 0
       ORDER BY recorded_time ASC, id ASC`,
      [workerInfo.id, nowInfo.workDate]
    );
    const todayLogs = rows.map(mapRowToAttendanceLog);
    const liveState = evaluateWorkerLiveState(todayLogs, settings);
    liveState.worker_profile = {
      full_name: workerInfo.full_name,
      avatar_url: workerInfo.avatar_url,
      collaboration_start_shamsi: settings.collaboration_start_shamsi || workerInfo.collaboration_start_shamsi || "1405/06/15",
      phone_number: settings.worker_phone_number || workerInfo.phone_number
    };
    await attachForgottenCheckoutWarning(pool2, workerInfo.id, liveState, settings, nowInfo);
    const [unreadRows] = await pool2.execute(
      "SELECT COUNT(*) AS cnt FROM work_correspondences WHERE receiver_user_id = ? AND is_read = 0",
      [req.user.id]
    );
    const unreadMessagesCount = Number(unreadRows[0]?.cnt || 0);
    let latestUnreadMessage = null;
    if (unreadMessagesCount > 0) {
      const [latestMsgRows] = await pool2.execute(
        `SELECT c.id, c.subject, c.message_text, c.shamsi_date, c.recorded_time, u.full_name AS sender_name
         FROM work_correspondences c
         INNER JOIN users u ON u.id = c.sender_user_id
         WHERE c.receiver_user_id = ? AND c.is_read = 0
         ORDER BY c.id DESC
         LIMIT 1`,
        [req.user.id]
      );
      if (latestMsgRows.length > 0) {
        const m = latestMsgRows[0];
        latestUnreadMessage = {
          id: Number(m.id),
          subject: m.subject ? String(m.subject) : null,
          message_text: String(m.message_text || ""),
          sender_name: String(m.sender_name || "\u0645\u062F\u06CC\u0631\u06CC\u062A"),
          shamsi_date: String(m.shamsi_date || ""),
          recorded_time: String(m.recorded_time || "").slice(0, 5)
        };
      }
    }
    const [allLogRows] = await pool2.execute(
      `SELECT * FROM attendance_logs
       WHERE user_id = ? AND is_deleted = 0
       ORDER BY work_date DESC, recorded_time ASC, id ASC`,
      [workerInfo.id]
    );
    const allLogs = allLogRows.map(mapRowToAttendanceLog);
    const byDate = /* @__PURE__ */ new Map();
    for (const log of allLogs) {
      const list = byDate.get(log.work_date) || [];
      list.push(log);
      byDate.set(log.work_date, list);
    }
    let totalConfirmedNetWorkMinutes = 0;
    let totalConfirmedOvertimeMinutes = 0;
    let totalRecordedWorkDays = 0;
    let hourlyEarnedRegularWorkToman = 0;
    let earnedOvertimeToman = 0;
    let totalLateAndAbsenceDeductionToman = 0;
    const confirmedAttendanceShamsiDates = /* @__PURE__ */ new Set();
    const activeMonthlyCycles = /* @__PURE__ */ new Set();
    const recentLateDecisions = [];
    for (const [workDate, dayLogs] of byDate.entries()) {
      const shamsiDate = normalizeShamsiDate(dayLogs[0]?.shamsi_date || gregorianToShamsi(workDate));
      const effectiveSettings = await getSystemSettingsFromDb(shamsiDate);
      const summary = calculateDailyAttendance(workDate, shamsiDate, dayLogs, effectiveSettings, {
        isToday: workDate === nowInfo.workDate,
        currentTimeHHMM: nowInfo.timeHHMM
      });
      if (summary.late_status && summary.late_status !== "NONE" && (summary.raw_late_minutes || 0) > 0 && recentLateDecisions.length < 15) {
        recentLateDecisions.push(summary);
      }
      if (summary.late_deduction_toman && summary.late_deduction_toman > 0) {
        totalLateAndAbsenceDeductionToman += summary.late_deduction_toman;
      }
      if (!summary.is_incomplete && summary.logs.length > 0) {
        confirmedAttendanceShamsiDates.add(shamsiDate);
        if (summary.net_work_minutes > 0 || summary.overtime_minutes > 0 || summary.late_status === "ABSENCE") {
          activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(shamsiDate, 15));
        }
        if (summary.late_status !== "ABSENCE") {
          totalRecordedWorkDays += 1;
        }
        totalConfirmedNetWorkMinutes += summary.net_work_minutes;
        totalConfirmedOvertimeMinutes += summary.overtime_minutes;
        const dayRegularMinutes = Math.max(0, summary.net_work_minutes - summary.overtime_minutes);
        const daySalaryCalc = calculateSalaryAndOvertimeRates(
          effectiveSettings,
          summary.overtime_minutes
        );
        hourlyEarnedRegularWorkToman += Math.round(
          dayRegularMinutes / 60 * daySalaryCalc.effectiveHourlyRateToman
        );
        earnedOvertimeToman += daySalaryCalc.totalOvertimePayToman;
      }
    }
    const [approvedHistRows] = await pool2.execute(
      `SELECT * FROM historical_work_records
       WHERE user_id = ? AND status = 'APPROVED'
       ORDER BY work_date ASC, id ASC`,
      [workerInfo.id]
    );
    const approvedHistoricalRecords = approvedHistRows.map(mapRowToHistoricalWork);
    for (const rec of approvedHistoricalRecords) {
      if (rec.parsed_rows && rec.parsed_rows.length > 0) {
        for (const row of rec.parsed_rows) {
          if (!row.shamsi_date || !isValidShamsiDate(row.shamsi_date)) continue;
          const normShamsi = normalizeShamsiDate(row.shamsi_date);
          if (confirmedAttendanceShamsiDates.has(normShamsi)) continue;
          confirmedAttendanceShamsiDates.add(normShamsi);
          const rowNetMins = Number(row.net_work_minutes || 0);
          const rowOtMins = Number(row.overtime_minutes || 0);
          if (rowNetMins > 0 || rowOtMins > 0) {
            activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(normShamsi, 15));
          }
          totalRecordedWorkDays += 1;
          totalConfirmedNetWorkMinutes += rowNetMins;
          totalConfirmedOvertimeMinutes += rowOtMins;
          const effSet = await getSystemSettingsFromDb(normShamsi);
          const rowCalc = calculateSalaryAndOvertimeRates(effSet, rowOtMins);
          hourlyEarnedRegularWorkToman += Math.round(
            rowNetMins / 60 * rowCalc.effectiveHourlyRateToman
          );
          earnedOvertimeToman += rowCalc.totalOvertimePayToman;
        }
      } else {
        const normShamsi = isValidShamsiDate(rec.shamsi_date) ? normalizeShamsiDate(rec.shamsi_date) : rec.shamsi_date;
        if (rec.work_days_count === 1 && confirmedAttendanceShamsiDates.has(normShamsi)) {
          continue;
        }
        if (rec.work_days_count === 1 && normShamsi) {
          confirmedAttendanceShamsiDates.add(normShamsi);
        }
        if ((rec.net_work_minutes > 0 || rec.overtime_minutes > 0) && normShamsi && isValidShamsiDate(normShamsi)) {
          activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(normShamsi, 15));
        }
        totalRecordedWorkDays += rec.work_days_count;
        totalConfirmedNetWorkMinutes += rec.net_work_minutes;
        totalConfirmedOvertimeMinutes += rec.overtime_minutes;
        const effSet = await getSystemSettingsFromDb(normShamsi);
        const recCalc = calculateSalaryAndOvertimeRates(effSet, rec.overtime_minutes);
        hourlyEarnedRegularWorkToman += Math.round(
          rec.net_work_minutes / 60 * recCalc.effectiveHourlyRateToman
        );
        earnedOvertimeToman += recCalc.totalOvertimePayToman;
      }
    }
    const hasMonthlyFixedSalary = settings.base_salary_toman !== null && settings.base_salary_toman !== void 0 && Number(settings.base_salary_toman) > 0 && (settings.hourly_rate_toman === null || settings.hourly_rate_toman === void 0 || Number(settings.hourly_rate_toman) <= 0);
    const earnedRegularWorkToman = hasMonthlyFixedSalary ? activeMonthlyCycles.size * Math.round(Number(settings.base_salary_toman)) : hourlyEarnedRegularWorkToman;
    const [finTotals] = await pool2.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' AND tx_type != 'PETTY_CASH' THEN amount_toman ELSE 0 END), 0) AS approved_received_salary_advance,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' AND tx_type = 'PETTY_CASH' THEN amount_toman ELSE 0 END), 0) AS approved_petty_cash
       FROM financial_transactions
       WHERE user_id = ?`,
      [workerInfo.id]
    );
    const approvedTotalToman = Number(finTotals[0]?.approved_total || 0);
    const approvedReceivedToman = Number(finTotals[0]?.approved_received_salary_advance || 0);
    const approvedPettyCashToman = Number(finTotals[0]?.approved_petty_cash || 0);
    const netSalaryPlusOvertimeToman = Math.max(
      0,
      earnedRegularWorkToman + earnedOvertimeToman - totalLateAndAbsenceDeductionToman
    );
    const totalEntitlementToman = netSalaryPlusOvertimeToman + approvedPettyCashToman;
    const accountBalanceToman = totalEntitlementToman - approvedReceivedToman;
    const [pendingTaskRows] = await pool2.execute(
      `SELECT id, title, description, shamsi_date, created_at
       FROM work_tasks
       WHERE user_id = ? AND is_completed = 0
       ORDER BY id DESC
       LIMIT 1`,
      [workerInfo.id]
    );
    const latestPendingTask = pendingTaskRows.length > 0 ? {
      id: Number(pendingTaskRows[0].id),
      title: String(pendingTaskRows[0].title || ""),
      description: pendingTaskRows[0].description ? String(pendingTaskRows[0].description) : null,
      shamsi_date: String(pendingTaskRows[0].shamsi_date || ""),
      created_at: pendingTaskRows[0].created_at ? new Date(pendingTaskRows[0].created_at).toISOString() : ""
    } : null;
    const unseenLateDecisions = recentLateDecisions.filter(
      (d) => d.late_status && d.late_status !== "NONE" && d.late_status !== "PENDING" && d.is_late_seen_by_worker === false
    );
    res.json({
      ok: true,
      serverTime: nowInfo,
      liveState,
      settings: sanitizeSettingsForRole(settings, req.user.role),
      unreadMessagesCount,
      latestUnreadMessage,
      latestPendingTask,
      unseenLateDecisions,
      recentLateDecisions,
      workerKpis: {
        totalWorkDays: totalRecordedWorkDays,
        totalNetWorkMinutes: totalConfirmedNetWorkMinutes,
        totalOvertimeMinutes: totalConfirmedOvertimeMinutes,
        approvedTotalToman,
        approvedReceivedToman,
        approvedPettyCashToman,
        earnedRegularWorkToman,
        earnedOvertimeToman,
        lateAndAbsenceDeductionToman: totalLateAndAbsenceDeductionToman,
        totalEntitlementToman,
        accountBalanceToman
      },
      bannerBgUrl: settings.banner_bg_url || "/assets/media/banner-bg.svg"
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post(
  "/attendance/clock",
  requireAuth,
  requireRole("worker"),
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const eventType = String(req.body?.event_type || "").trim();
      const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
      const rawIdempotency = req.body?.idempotency_key || req.headers["x-idempotency-key"] || null;
      const idempotencyKey = rawIdempotency ? String(rawIdempotency).trim().slice(0, 64) : null;
      const validEvents = [
        "WORK_START",
        "MISSION_START",
        "MISSION_END",
        "WORK_END"
      ];
      if (!validEvents.includes(eventType)) {
        res.status(400).json({
          ok: false,
          message: "\u0646\u0648\u0639 \u0639\u0645\u0644\u06CC\u0627\u062A \u062A\u0631\u062F\u062F \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A."
        });
        return;
      }
      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const workerInfo = await getWorkerInfo(pool2);
      const workerId = req.user.id;
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      await conn.execute(
        `SELECT id FROM users WHERE id = ? FOR UPDATE`,
        [workerId]
      );
      if (idempotencyKey) {
        const [dupKeyRows] = await conn.execute(
          `SELECT id FROM attendance_logs WHERE idempotency_key = ? LIMIT 1`,
          [idempotencyKey]
        );
        if (dupKeyRows.length > 0) {
          await conn.rollback();
          res.status(409).json({
            ok: false,
            code: "DUPLICATE_REQUEST",
            message: "\u0627\u06CC\u0646 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062A\u0631\u062F\u062F \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A."
          });
          return;
        }
      }
      const [existingRows] = await conn.execute(
        `SELECT * FROM attendance_logs
         WHERE user_id = ? AND work_date = ? AND is_deleted = 0
         ORDER BY recorded_time ASC, id ASC
         FOR UPDATE`,
        [workerId, nowInfo.workDate]
      );
      const existingLogs = existingRows.map(mapRowToAttendanceLog);
      const validation = validateAttendanceSequence(existingLogs, eventType, nowInfo.timeHHMMSS);
      if (!validation.valid) {
        await conn.rollback();
        res.status(400).json({
          ok: false,
          code: "INVALID_ATTENDANCE_TRANSITION",
          message: validation.error
        });
        return;
      }
      const recordedAt = `${nowInfo.workDate} ${nowInfo.timeHHMMSS}`;
      const rawLateReason = req.body?.late_reason ? String(req.body.late_reason).trim().slice(0, 500) : null;
      let lateStatus = "NONE";
      let lateReasonToSave = null;
      if (eventType === "WORK_START" && existingLogs.length === 0) {
        const dayOfWeek = getDayOfWeekFromGregorian(nowInfo.workDate);
        const normShamsi = normalizeShamsiDate(nowInfo.shamsiDate);
        const isHoliday = settings.official_holidays.some(
          (h) => (isValidShamsiDate(h) ? normalizeShamsiDate(h) : h) === normShamsi
        );
        const isWorkingDay = settings.working_days.includes(dayOfWeek) && !isHoliday;
        const { shiftStartMin } = getDayShiftSchedule(dayOfWeek, settings);
        const nowMin = parseTimeToMinutes(nowInfo.timeHHMM);
        if (isWorkingDay && nowMin > shiftStartMin + settings.grace_period_minutes) {
          lateStatus = "PENDING";
          lateReasonToSave = rawLateReason || note || "\u0648\u0631\u0648\u062F \u0628\u0627 \u062A\u0623\u062E\u06CC\u0631 (\u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631 \u0628\u0631\u0631\u0633\u06CC \u0645\u062F\u06CC\u0631\u06CC\u062A)";
        }
      }
      const [insertResult] = await conn.execute(
        `INSERT INTO attendance_logs
          (user_id, work_date, shamsi_date, event_type, recorded_at, recorded_time, note, is_manual_override, is_deleted, late_status, late_reason, is_late_seen_by_worker, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1, ?)`,
        [
          workerId,
          nowInfo.workDate,
          nowInfo.shamsiDate,
          eventType,
          recordedAt,
          nowInfo.timeHHMMSS,
          note || lateReasonToSave,
          lateStatus,
          lateReasonToSave,
          idempotencyKey
        ]
      );
      await recordAuditLog({
        actorUserId: workerId,
        actionType: "ATTENDANCE_CLOCK",
        targetEntity: "attendance_logs",
        targetId: insertResult.insertId,
        afterState: {
          shamsi_date: nowInfo.shamsiDate,
          event_type: eventType,
          recorded_time: nowInfo.timeHHMMSS
        },
        ipAddress: req.ip || null,
        connection: conn
      });
      if (getSimulatedMidTransactionFailure() === "attendance_clock") {
        throw new Error("SIMULATED_DB_DISCONNECT");
      }
      await conn.commit();
      const [updatedRows] = await pool2.execute(
        `SELECT * FROM attendance_logs
         WHERE user_id = ? AND work_date = ? AND is_deleted = 0
         ORDER BY recorded_time ASC, id ASC`,
        [workerId, nowInfo.workDate]
      );
      const updatedLogs = updatedRows.map(mapRowToAttendanceLog);
      const liveState = evaluateWorkerLiveState(updatedLogs, settings);
      liveState.worker_profile = {
        full_name: workerInfo.full_name,
        avatar_url: workerInfo.avatar_url,
        collaboration_start_shamsi: settings.collaboration_start_shamsi || workerInfo.collaboration_start_shamsi,
        phone_number: settings.worker_phone_number || workerInfo.phone_number
      };
      await attachForgottenCheckoutWarning(pool2, workerInfo.id, liveState, settings, nowInfo);
      res.status(201).json({
        ok: true,
        logId: insertResult.insertId,
        message: "\u0639\u0645\u0644\u06CC\u0627\u062A \u062A\u0631\u062F\u062F \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F.",
        liveState
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      const errObj = err;
      if (errObj?.code === "ER_DUP_ENTRY") {
        res.status(409).json({
          ok: false,
          code: "DUPLICATE_REQUEST",
          message: "\u0627\u06CC\u0646 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062A\u0631\u062F\u062F \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A."
        });
        return;
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.get("/attendance/history", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const workerId = await resolveTargetWorkerId(pool2, req, res);
    if (workerId === null) return;
    const currentSettings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(currentSettings.timezone);
    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : null;
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : null;
    let sql = `SELECT * FROM attendance_logs WHERE user_id = ? AND is_deleted = 0`;
    const params = [workerId];
    if (fromShamsi) {
      sql += ` AND shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND shamsi_date <= ?`;
      params.push(toShamsi);
    }
    sql += ` ORDER BY work_date DESC, recorded_time ASC, id ASC LIMIT 600`;
    const [rows] = await pool2.execute(sql, params);
    const logs = rows.map(mapRowToAttendanceLog);
    const byDate = /* @__PURE__ */ new Map();
    for (const log of logs) {
      const list = byDate.get(log.work_date) || [];
      list.push(log);
      byDate.set(log.work_date, list);
    }
    const dailySummaries = [];
    for (const [workDate, dayLogs] of byDate.entries()) {
      const shamsiDate = dayLogs[0]?.shamsi_date || gregorianToShamsi(workDate);
      const effectiveSettings = await getSystemSettingsFromDb(shamsiDate);
      const summary = calculateDailyAttendance(workDate, shamsiDate, dayLogs, effectiveSettings, {
        isToday: workDate === nowInfo.workDate,
        currentTimeHHMM: nowInfo.timeHHMM
      });
      dailySummaries.push(summary);
    }
    const [histRows] = await pool2.execute(
      `SELECT h.*, u.role AS creator_role
       FROM historical_work_records h
       LEFT JOIN users u ON u.id = h.created_by_user_id
       WHERE h.user_id = ?
       ORDER BY h.work_date DESC, h.id DESC`,
      [workerId]
    );
    const historicalRecords = histRows.map(mapRowToHistoricalWork);
    const mergedSummaries = mergeApprovedHistoricalIntoDailySummaries(
      dailySummaries,
      historicalRecords,
      fromShamsi,
      toShamsi
    );
    res.json({
      ok: true,
      dailySummaries: mergedSummaries,
      historicalRecords
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
async function computeLeaveQuotaSummary(pool2, workerId, currentShamsiDate, monthlyQuotaDays = 2.5) {
  const currentMonthPrefix = currentShamsiDate.slice(0, 7);
  const currentYearPrefix = currentShamsiDate.slice(0, 4);
  const [rows] = await pool2.execute(
    `SELECT shamsi_date, duration_minutes, status
     FROM leave_requests
     WHERE user_id = ?`,
    [workerId]
  );
  let usedCurrentMonthMinutes = 0;
  let usedYearMinutes = 0;
  let pendingCount = 0;
  for (const r of rows) {
    const st = String(r.status);
    const sh = String(r.shamsi_date || "");
    const mins = Number(r.duration_minutes || 0);
    if (st === "PENDING") {
      pendingCount += 1;
    } else if (st === "APPROVED") {
      if (sh.startsWith(currentMonthPrefix)) {
        usedCurrentMonthMinutes += mins;
      }
      if (sh.startsWith(currentYearPrefix)) {
        usedYearMinutes += mins;
      }
    }
  }
  const monthlyQuotaMinutes = Math.round(monthlyQuotaDays * 480);
  const remainingMonthMinutes = Math.max(0, monthlyQuotaMinutes - usedCurrentMonthMinutes);
  const formatDaysAndHours = (totalMins) => {
    const days = Math.floor(totalMins / 480);
    const remMins = totalMins % 480;
    const hours = Math.floor(remMins / 60);
    const mins = remMins % 60;
    const parts = [];
    if (days > 0) parts.push(`${toPersianDigits(days)} \u0631\u0648\u0632`);
    if (hours > 0) parts.push(`${toPersianDigits(hours)} \u0633\u0627\u0639\u062A`);
    if (mins > 0) parts.push(`${toPersianDigits(mins)} \u062F\u0642\u06CC\u0642\u0647`);
    return parts.length > 0 ? parts.join(" \u0648 ") : "\u06F0 \u0633\u0627\u0639\u062A";
  };
  return {
    monthlyQuotaDays,
    monthlyQuotaMinutes,
    usedCurrentMonthMinutes,
    usedCurrentMonthDaysFormatted: formatDaysAndHours(usedCurrentMonthMinutes),
    remainingMonthMinutes,
    remainingMonthDaysFormatted: formatDaysAndHours(remainingMonthMinutes),
    usedYearMinutes,
    pendingCount
  };
}
apiRouter.get("/leaves", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const workerId = await resolveTargetWorkerId(pool2, req, res);
    if (workerId === null) return;
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const [rows] = await pool2.execute(
      `SELECT * FROM leave_requests WHERE user_id = ? ORDER BY work_date DESC, id DESC LIMIT 200`,
      [workerId]
    );
    const leaveRequests = rows.map(mapRowToLeaveRequest);
    const quotaSummary = await computeLeaveQuotaSummary(
      pool2,
      workerId,
      nowInfo.shamsiDate,
      settings.monthly_leave_quota_days || 2.5
    );
    res.json({
      ok: true,
      leaveRequests,
      quotaSummary
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/leaves", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const workerId = await resolveTargetWorkerId(pool2, req, res);
    if (workerId === null) return;
    const shamsiRaw = String(req.body?.shamsi_date || "").trim();
    if (!isValidShamsiDate(shamsiRaw)) {
      res.status(400).json({ ok: false, message: "\u062A\u0627\u0631\u06CC\u062E \u0627\u0646\u062A\u062E\u0627\u0628\u200C\u0634\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
      return;
    }
    const shamsiDate = normalizeShamsiDate(shamsiRaw);
    const workDate = shamsiToGregorian(shamsiDate);
    const leaveType = req.body?.leave_type === "HOURLY" ? "HOURLY" : "DAILY";
    const reason = String(req.body?.reason || "").trim();
    if (!reason || reason.length < 2) {
      res.status(400).json({ ok: false, message: "\u0644\u0637\u0641\u0627\u064B \u0639\u0644\u062A \u06CC\u0627 \u062A\u0648\u0636\u06CC\u062D \u0645\u0631\u062E\u0635\u06CC \u0631\u0627 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F." });
      return;
    }
    let startTime = null;
    let endTime = null;
    let durationMinutes = 480;
    if (leaveType === "HOURLY") {
      startTime = toEnglishDigits(String(req.body?.start_time || "")).trim();
      endTime = toEnglishDigits(String(req.body?.end_time || "")).trim();
      if (!isValidTimeHHMMOrHHMMSS(startTime, false) || !isValidTimeHHMMOrHHMMSS(endTime, false)) {
        res.status(400).json({ ok: false, message: "\u0633\u0627\u0639\u062A \u0634\u0631\u0648\u0639 \u0648 \u067E\u0627\u06CC\u0627\u0646 \u0645\u0631\u062E\u0635\u06CC \u0633\u0627\u0639\u062A\u06CC \u0631\u0627 \u0628\u0627 \u0641\u0631\u0645\u062A \u0645\u0639\u062A\u0628\u0631 (\u06F0\u06F0:\u06F0\u06F0 \u062A\u0627 \u06F2\u06F3:\u06F5\u06F9) \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F." });
        return;
      }
      const sMins = parseTimeToMinutes(startTime);
      const eMins = parseTimeToMinutes(endTime);
      if (eMins <= sMins) {
        res.status(400).json({ ok: false, message: "\u0633\u0627\u0639\u062A \u067E\u0627\u06CC\u0627\u0646 \u0645\u0631\u062E\u0635\u06CC \u0628\u0627\u06CC\u062F \u0628\u0639\u062F \u0627\u0632 \u0633\u0627\u0639\u062A \u0634\u0631\u0648\u0639 \u0628\u0627\u0634\u062F." });
        return;
      }
      durationMinutes = eMins - sMins;
    }
    const isManager = req.user.role === "manager";
    const initialStatus = isManager ? "APPROVED" : "PENDING";
    const seenByManager = isManager ? 1 : 0;
    const [ins] = await pool2.execute(
      `INSERT INTO leave_requests
        (user_id, shamsi_date, work_date, leave_type, start_time, end_time, duration_minutes, reason, status, is_seen_by_manager, reviewed_by_user_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workerId,
        shamsiDate,
        workDate,
        leaveType,
        startTime,
        endTime,
        durationMinutes,
        reason,
        initialStatus,
        seenByManager,
        isManager ? req.user.id : null,
        isManager ? /* @__PURE__ */ new Date() : null
      ]
    );
    res.status(201).json({
      ok: true,
      id: ins.insertId,
      message: isManager ? "\u0645\u0631\u062E\u0635\u06CC \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F." : "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0631\u062E\u0635\u06CC \u062B\u0628\u062A \u0634\u062F \u0648 \u0628\u0631\u0627\u06CC \u062A\u0623\u06CC\u06CC\u062F \u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u06AF\u0631\u062F\u06CC\u062F."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post(
  "/leaves/:id/review",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const leaveId = Number(req.params.id);
      const decision = String(req.body?.decision || "");
      const managerNote = req.body?.manager_note ? String(req.body.manager_note).trim().slice(0, 500) : null;
      if (!leaveId || !["APPROVED", "REJECTED"].includes(decision)) {
        res.status(400).json({ ok: false, message: "\u0645\u0634\u062E\u0635\u0627\u062A \u0628\u0631\u0631\u0633\u06CC \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0631\u062E\u0635\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      const pool2 = getPool();
      await pool2.execute(
        `UPDATE leave_requests
         SET status = ?, is_seen_by_manager = 1, manager_note = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [decision, managerNote, req.user.id, leaveId]
      );
      res.json({
        ok: true,
        message: decision === "APPROVED" ? "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0631\u062E\u0635\u06CC \u067E\u0631\u0633\u0646\u0644 \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F \u0648 \u062F\u0631 \u0633\u0647\u0645\u06CC\u0647 \u0645\u0631\u062E\u0635\u06CC \u0645\u062D\u0627\u0633\u0628\u0647 \u06AF\u0631\u062F\u06CC\u062F." : "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0631\u062E\u0635\u06CC \u0631\u062F \u0634\u062F."
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get("/historical-work/excel-template", requireAuth, (_req, res) => {
  try {
    const sampleData = [
      {
        "\u062A\u0627\u0631\u06CC\u062E": "1405/06/31",
        "\u0639\u0646\u0648\u0627\u0646 \u062F\u0648\u0631\u0647 \u06CC\u0627 \u0631\u0648\u0632": "\u06A9\u0627\u0631\u06A9\u0631\u062F \u0634\u0647\u0631\u06CC\u0648\u0631 \u06F1\u06F4\u06F0\u06F5",
        "\u062A\u0639\u062F\u0627\u062F \u0631\u0648\u0632 \u06A9\u0627\u0631\u06CC": 24,
        "\u0633\u0627\u0639\u062A \u06A9\u0627\u0631\u06A9\u0631\u062F \u062E\u0627\u0644\u0635": 176,
        "\u062F\u0642\u06CC\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u062E\u0627\u0644\u0635": 0,
        "\u0633\u0627\u0639\u062A \u0627\u0636\u0627\u0641\u0647 \u06A9\u0627\u0631\u06CC": 18,
        "\u062F\u0642\u06CC\u0642\u0647 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0627\u0631\u06CC": 30,
        "\u062A\u0648\u0636\u06CC\u062D\u0627\u062A": "\u062B\u0628\u062A \u062A\u062C\u0645\u06CC\u0639\u06CC \u0634\u0647\u0631\u06CC\u0648\u0631 \u0645\u0627\u0647"
      },
      {
        "\u062A\u0627\u0631\u06CC\u062E": "1405/07/15",
        "\u0639\u0646\u0648\u0627\u0646 \u062F\u0648\u0631\u0647 \u06CC\u0627 \u0631\u0648\u0632": "\u0646\u06CC\u0645\u0647 \u0627\u0648\u0644 \u0645\u0647\u0631 \u06F1\u06F4\u06F0\u06F5",
        "\u062A\u0639\u062F\u0627\u062F \u0631\u0648\u0632 \u06A9\u0627\u0631\u06CC": 12,
        "\u0633\u0627\u0639\u062A \u06A9\u0627\u0631\u06A9\u0631\u062F \u062E\u0627\u0644\u0635": 88,
        "\u062F\u0642\u06CC\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u062E\u0627\u0644\u0635": 15,
        "\u0633\u0627\u0639\u062A \u0627\u0636\u0627\u0641\u0647 \u06A9\u0627\u0631\u06CC": 9,
        "\u062F\u0642\u06CC\u0642\u0647 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0627\u0631\u06CC": 45,
        "\u062A\u0648\u0636\u06CC\u062D\u0627\u062A": "\u067E\u0631\u0648\u0698\u0647 \u0627\u062C\u0631\u0627\u06CC\u06CC \u0645\u0647\u0631"
      }
    ];
    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "\u0633\u0648\u0627\u0628\u0642 \u06A9\u0627\u0631\u06A9\u0631\u062F");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="mgammon-work-history-template.xlsx"'
    );
    res.send(buffer);
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/historical-work/upload-excel", requireAuth, async (req, res) => {
  const pool2 = getPool();
  let conn = null;
  try {
    const fileName = String(req.body?.file_name || "work-history.xlsx").trim();
    const fileBase64 = String(req.body?.file_base64 || "").trim();
    const fallbackTitle = String(req.body?.title || "").trim() || `\u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644: ${fileName}`;
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
    if (!fileBase64) {
      res.status(400).json({ ok: false, message: "\u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u0627\u0646\u062A\u062E\u0627\u0628 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A." });
      return;
    }
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0") || !/\.(xlsx|xls)$/i.test(fileName)) {
      res.status(400).json({ ok: false, message: "\u0646\u0627\u0645 \u06CC\u0627 \u067E\u0633\u0648\u0646\u062F \u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A (\u0641\u0642\u0637 .xlsx \u06CC\u0627 .xls \u0645\u062C\u0627\u0632 \u0627\u0633\u062A)." });
      return;
    }
    const cleanBase64 = (fileBase64.includes(",") ? fileBase64.split(",")[1] : fileBase64).trim();
    if (!cleanBase64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(cleanBase64)) {
      res.status(400).json({ ok: false, message: "\u0645\u062D\u062A\u0648\u0627\u06CC \u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A." });
      return;
    }
    const buffer = Buffer.from(cleanBase64, "base64");
    if (buffer.length > 2 * 1024 * 1024) {
      res.status(413).json({
        ok: false,
        code: "FILE_TOO_LARGE",
        message: "\u062D\u062C\u0645 \u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u0646\u0628\u0627\u06CC\u062F \u0628\u06CC\u0634\u062A\u0631 \u0627\u0632 \u06F2 \u0645\u06AF\u0627\u0628\u0627\u06CC\u062A \u0628\u0627\u0634\u062F."
      });
      return;
    }
    const sig = detectFileSignature(buffer);
    if (sig !== "xlsx" && sig !== "xls") {
      res.status(400).json({
        ok: false,
        code: "INVALID_EXCEL_SIGNATURE",
        message: "\u0641\u0627\u06CC\u0644 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC\u200C\u0634\u062F\u0647 \u06CC\u06A9 \u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u0648\u0627\u0642\u0639\u06CC \u0648 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A."
      });
      return;
    }
    let workbook;
    try {
      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellFormula: false,
        cellHTML: false
      });
    } catch {
      res.status(400).json({ ok: false, message: "\u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u062E\u0631\u0627\u0628 \u06CC\u0627 \u063A\u06CC\u0631\u0642\u0627\u0628\u0644 \u062E\u0648\u0627\u0646\u062F\u0646 \u0627\u0633\u062A." });
      return;
    }
    const firstSheetName = workbook.SheetNames?.[0];
    if (!firstSheetName) {
      res.status(400).json({ ok: false, message: "\u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A \u06CC\u0627 \u0628\u0631\u06AF\u0647 (Sheet) \u0646\u062F\u0627\u0631\u062F." });
      return;
    }
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rawRows.length === 0) {
      res.status(400).json({ ok: false, message: "\u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u062E\u0627\u0644\u06CC \u0627\u0633\u062A \u0648 \u0647\u06CC\u0686 \u0631\u062F\u06CC\u0641 \u062F\u0627\u062F\u0647\u200C\u0627\u06CC \u0646\u062F\u0627\u0631\u062F." });
      return;
    }
    if (rawRows.length > 500) {
      res.status(400).json({
        ok: false,
        message: "\u062A\u0639\u062F\u0627\u062F \u0631\u062F\u06CC\u0641\u200C\u0647\u0627\u06CC \u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 (\u062D\u062F\u0627\u06A9\u062B\u0631 \u06F5\u06F0\u06F0 \u0631\u062F\u06CC\u0641) \u0627\u0633\u062A."
      });
      return;
    }
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const parsedRows = [];
    let totalDays = 0;
    let totalNetMinutes = 0;
    let totalOtMinutes = 0;
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const rawDate = toEnglishDigits(
        String(
          r["\u062A\u0627\u0631\u06CC\u062E \u0634\u0645\u0633\u06CC"] || r["\u062A\u0627\u0631\u06CC\u062E"] || r["jalali_date"] || r["date"] || r["shamsi_date"] || nowInfo.shamsiDate
        )
      ).trim();
      const rowShamsi = isValidShamsiDate(rawDate) ? normalizeShamsiDate(rawDate) : nowInfo.shamsiDate;
      const checkInRaw = toEnglishDigits(
        String(r["\u0633\u0627\u0639\u062A \u0648\u0631\u0648\u062F"] || r["\u0648\u0631\u0648\u062F"] || r["check_in"] || "")
      ).trim();
      const checkOutRaw = toEnglishDigits(
        String(r["\u0633\u0627\u0639\u062A \u062E\u0631\u0648\u062C"] || r["\u062E\u0631\u0648\u062C"] || r["check_out"] || "")
      ).trim();
      const checkIn = /^\d{1,2}:\d{2}$/.test(checkInRaw) ? checkInRaw.padStart(5, "0") : void 0;
      const checkOut = /^\d{1,2}:\d{2}$/.test(checkOutRaw) ? checkOutRaw.padStart(5, "0") : void 0;
      const rowTitle = String(
        r["\u0639\u0646\u0648\u0627\u0646 \u062F\u0648\u0631\u0647 \u06CC\u0627 \u0631\u0648\u0632"] || r["\u0639\u0646\u0648\u0627\u0646"] || r["\u0634\u0631\u062D"] || r["title"] || `\u06A9\u0627\u0631\u06A9\u0631\u062F \u0631\u0648\u0632\u0627\u0646\u0647 ${rowShamsi}`
      ).trim();
      const days = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(r["\u062A\u0639\u062F\u0627\u062F \u0631\u0648\u0632 \u06A9\u0627\u0631\u06CC"] ?? r["\u0631\u0648\u0632 \u06A9\u0627\u0631\u06CC"] ?? r["\u0631\u0648\u0632"] ?? r["days"] ?? 1)
          )
        ) || 0
      );
      const netH = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(
              r["\u0633\u0627\u0639\u062A \u06A9\u0627\u0631\u06A9\u0631\u062F \u062E\u0627\u0644\u0635"] ?? r["\u0633\u0627\u0639\u062A \u06A9\u0627\u0631\u06A9\u0631\u062F"] ?? r["\u0633\u0627\u0639\u062A \u06A9\u0627\u0631\u06CC"] ?? r["work_hours"] ?? r["hours"] ?? 0
            )
          )
        ) || 0
      );
      const netM = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(
              r["\u062F\u0642\u06CC\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u062E\u0627\u0644\u0635"] ?? r["\u062F\u0642\u06CC\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F"] ?? r["\u062F\u0642\u06CC\u0642\u0647 \u06A9\u0627\u0631\u06CC"] ?? r["work_minutes"] ?? 0
            )
          )
        ) || 0
      );
      const otH = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(r["\u0633\u0627\u0639\u062A \u0627\u0636\u0627\u0641\u0647 \u06A9\u0627\u0631\u06CC"] ?? r["\u0633\u0627\u0639\u062A \u0627\u0636\u0627\u0641\u0647\u200C\u06A9\u0627\u0631\u06CC"] ?? r["\u0627\u0636\u0627\u0641\u0647 \u06A9\u0627\u0631\u06CC"] ?? r["overtime_hours"] ?? 0)
          )
        ) || 0
      );
      const otM = Math.max(
        0,
        Number(
          toEnglishDigits(
            String(r["\u062F\u0642\u06CC\u0642\u0647 \u0627\u0636\u0627\u0641\u0647 \u06A9\u0627\u0631\u06CC"] ?? r["\u062F\u0642\u06CC\u0642\u0647 \u0627\u0636\u0627\u0641\u0647\u200C\u06A9\u0627\u0631\u06CC"] ?? r["overtime_minutes"] ?? 0)
          )
        ) || 0
      );
      let rowNetMins = Math.round(netH * 60 + netM);
      const rowOtMins = Math.round(otH * 60 + otM);
      if (rowNetMins === 0 && checkIn && checkOut) {
        const inM = parseTimeToMinutes(checkIn);
        const outM = parseTimeToMinutes(checkOut);
        if (outM > inM) {
          const totalPresence = outM - inM;
          rowNetMins = Math.max(0, totalPresence - rowOtMins);
        }
      }
      const rowNote = String(r["\u062A\u0648\u0636\u06CC\u062D\u0627\u062A"] || r["notes"] || r["note"] || "").trim() || void 0;
      if (rowNetMins > 0 || rowOtMins > 0 || days > 0) {
        parsedRows.push({
          shamsi_date: rowShamsi,
          title: rowTitle,
          work_days_count: days,
          net_work_minutes: rowNetMins,
          overtime_minutes: rowOtMins,
          check_in: checkIn,
          check_out: checkOut,
          note: rowNote
        });
        totalDays += days;
        totalNetMinutes += rowNetMins;
        totalOtMinutes += rowOtMins;
      }
    }
    if (parsedRows.length === 0 || totalNetMinutes === 0 && totalOtMinutes === 0) {
      res.status(400).json({
        ok: false,
        message: "\u0645\u0642\u0627\u062F\u06CC\u0631 \u0633\u0627\u0639\u062A \u06A9\u0627\u0631\u06A9\u0631\u062F \u06CC\u0627 \u0627\u0636\u0627\u0641\u0647\u200C\u06A9\u0627\u0631\u06CC \u062F\u0631 \u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F. \u0644\u0637\u0641\u0627\u064B \u0627\u0632 \u0639\u0646\u0627\u0648\u06CC\u0646 \u0633\u062A\u0648\u0646\u200C\u0647\u0627\u06CC \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F \u06CC\u0627 \u0641\u0627\u06CC\u0644 \u0646\u0645\u0648\u0646\u0647 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F."
      });
      return;
    }
    const savedFile = saveBase64MediaFile("excel", fileName, fileBase64);
    const shamsiDate = parsedRows[0]?.shamsi_date || nowInfo.shamsiDate;
    const workDate = shamsiToGregorian(shamsiDate);
    const workerId = await getWorkerUserId(pool2);
    const isManager = req.user.role === "manager";
    const initialStatus = isManager ? "APPROVED" : "PENDING";
    const seenByManager = isManager ? 1 : 0;
    conn = await pool2.getConnection();
    await conn.beginTransaction();
    const [existingDup] = await conn.execute(
      `SELECT id, status FROM historical_work_records
       WHERE user_id = ? AND shamsi_date = ? AND work_days_count = ? AND parsed_rows_json IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [workerId, shamsiDate, totalDays]
    );
    let recordId = 0;
    if (existingDup.length > 0) {
      recordId = Number(existingDup[0].id);
      const effectiveStatus = isManager || existingDup[0].status === "APPROVED" ? "APPROVED" : initialStatus;
      await conn.execute(
        `UPDATE historical_work_records
         SET title = ?, net_work_minutes = ?, overtime_minutes = ?, note = ?, status = ?,
             excel_file_url = ?, excel_file_name = ?, parsed_rows_json = ?, is_seen_by_manager = ?
         WHERE id = ?`,
        [
          fallbackTitle,
          totalNetMinutes,
          totalOtMinutes,
          note,
          effectiveStatus,
          savedFile.publicUrl,
          fileName,
          JSON.stringify(parsedRows),
          seenByManager,
          recordId
        ]
      );
    } else {
      const [ins] = await conn.execute(
        `INSERT INTO historical_work_records
          (user_id, shamsi_date, work_date, title, work_days_count, net_work_minutes, overtime_minutes, note, status, excel_file_url, excel_file_name, parsed_rows_json, is_seen_by_manager, created_by_user_id, reviewed_by_user_id, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          workerId,
          shamsiDate,
          workDate,
          fallbackTitle,
          totalDays,
          totalNetMinutes,
          totalOtMinutes,
          note,
          initialStatus,
          savedFile.publicUrl,
          fileName,
          JSON.stringify(parsedRows),
          seenByManager,
          req.user.id,
          isManager ? req.user.id : null,
          isManager ? /* @__PURE__ */ new Date() : null
        ]
      );
      recordId = ins.insertId;
    }
    await conn.commit();
    res.status(201).json({
      ok: true,
      id: recordId,
      parsedCount: parsedRows.length,
      message: isManager ? `\u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 (${parsedRows.length} \u0631\u0648\u0632 \u06A9\u0627\u0631\u06CC) \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u062F\u0631 \u062A\u0642\u0648\u06CC\u0645 \u06A9\u0627\u0631\u06A9\u0631\u062F \u0648 \u06A9\u0644 \u0645\u062D\u0627\u0633\u0628\u0627\u062A \u0644\u062D\u0627\u0638 \u0634\u062F.` : `\u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 (${parsedRows.length} \u0631\u0648\u0632 \u06A9\u0627\u0631\u06CC) \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0634\u062F \u0648 \u067E\u0633 \u0627\u0632 \u062A\u0623\u06CC\u06CC\u062F \u0645\u062F\u06CC\u0631\u06CC\u062A \u0628\u0647 \u06A9\u0644 \u0645\u062D\u0627\u0633\u0628\u0627\u062A \u0627\u0636\u0627\u0641\u0647 \u062E\u0648\u0627\u0647\u062F \u0634\u062F.`
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
      }
    }
    handleServerError(res, err);
  } finally {
    if (conn) conn.release();
  }
});
apiRouter.post("/historical-work", requireAuth, async (req, res) => {
  const pool2 = getPool();
  let conn = null;
  try {
    const shamsiRaw = String(req.body?.shamsi_date || "").trim();
    if (!isValidShamsiDate(shamsiRaw)) {
      res.status(400).json({ ok: false, message: "\u062A\u0627\u0631\u06CC\u062E \u0627\u0646\u062A\u062E\u0627\u0628\u200C\u0634\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
      return;
    }
    const shamsiDate = normalizeShamsiDate(shamsiRaw);
    const workDate = shamsiToGregorian(shamsiDate);
    const title = String(req.body?.title || "").trim();
    const workDaysCount = Math.max(0, Number(toEnglishDigits(String(req.body?.work_days_count ?? 1))));
    const netWorkDirectMinutes = Math.max(0, Number(toEnglishDigits(String(req.body?.net_work_minutes ?? 0))));
    const overtimeDirectMinutes = Math.max(0, Number(toEnglishDigits(String(req.body?.overtime_minutes ?? 0))));
    const netWorkHours = Math.max(0, Number(toEnglishDigits(String(req.body?.net_work_hours ?? 0))));
    const netWorkExtraMins = Math.max(0, Number(toEnglishDigits(String(req.body?.net_work_minutes_part ?? 0))));
    const overtimeHours = Math.max(0, Number(toEnglishDigits(String(req.body?.overtime_hours ?? 0))));
    const overtimeExtraMins = Math.max(0, Number(toEnglishDigits(String(req.body?.overtime_minutes_part ?? 0))));
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
    if (!title) {
      res.status(400).json({ ok: false, message: "\u0639\u0646\u0648\u0627\u0646 \u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06CC \u0642\u0628\u0644\u06CC \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
      return;
    }
    const totalNetWorkMinutes = netWorkDirectMinutes > 0 ? Math.round(netWorkDirectMinutes) : Math.round(netWorkHours * 60 + netWorkExtraMins);
    const totalOvertimeMinutes = overtimeDirectMinutes > 0 ? Math.round(overtimeDirectMinutes) : Math.round(overtimeHours * 60 + overtimeExtraMins);
    if (totalNetWorkMinutes === 0 && totalOvertimeMinutes === 0) {
      res.status(400).json({
        ok: false,
        message: "\u062D\u062F\u0627\u0642\u0644 \u06CC\u06A9\u06CC \u0627\u0632 \u0645\u0642\u0627\u062F\u06CC\u0631 \u0633\u0627\u0639\u0627\u062A \u06A9\u0627\u0631\u06CC \u06CC\u0627 \u0627\u0636\u0627\u0641\u0647\u200C\u06A9\u0627\u0631\u06CC \u0628\u0627\u06CC\u062F \u0628\u06CC\u0634\u062A\u0631 \u0627\u0632 \u0635\u0641\u0631 \u0628\u0627\u0634\u062F."
      });
      return;
    }
    const workerId = await getWorkerUserId(pool2);
    const isManager = req.user.role === "manager";
    const initialStatus = isManager ? "APPROVED" : "PENDING";
    const seenByManager = isManager ? 1 : 0;
    conn = await pool2.getConnection();
    await conn.beginTransaction();
    const [ins] = await conn.execute(
      `INSERT INTO historical_work_records
        (user_id, shamsi_date, work_date, title, work_days_count, net_work_minutes, overtime_minutes, note, status, is_seen_by_manager, created_by_user_id, reviewed_by_user_id, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workerId,
        shamsiDate,
        workDate,
        title,
        workDaysCount,
        totalNetWorkMinutes,
        totalOvertimeMinutes,
        note,
        initialStatus,
        seenByManager,
        req.user.id,
        isManager ? req.user.id : null,
        isManager ? /* @__PURE__ */ new Date() : null
      ]
    );
    await conn.commit();
    res.status(201).json({
      ok: true,
      id: ins.insertId,
      status: initialStatus,
      message: isManager ? "\u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u0648 \u0627\u0636\u0627\u0641\u0647\u200C\u06A9\u0627\u0631\u06CC \u0642\u0628\u0644\u06CC \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u0628\u0647 \u0645\u062C\u0645\u0648\u0639 \u06A9\u0644 \u0627\u0636\u0627\u0641\u0647 \u0634\u062F." : "\u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u0642\u0628\u0644\u06CC \u062B\u0628\u062A \u0634\u062F \u0648 \u067E\u0633 \u0627\u0632 \u062A\u0623\u06CC\u06CC\u062F \u0645\u062F\u06CC\u0631\u06CC\u062A \u0628\u0647 \u06A9\u0644 \u0645\u062D\u0627\u0633\u0628\u0627\u062A \u0627\u0636\u0627\u0641\u0647 \u0645\u06CC\u200C\u06AF\u0631\u062F\u062F."
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
      }
    }
    handleServerError(res, err);
  } finally {
    if (conn) conn.release();
  }
});
apiRouter.post(
  "/historical-work/:id/review",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const recordId = Number(req.params.id);
      const decision = String(req.body?.decision || "");
      if (!recordId || !["APPROVED", "REJECTED"].includes(decision)) {
        res.status(400).json({ ok: false, message: "\u067E\u0627\u0631\u0627\u0645\u062A\u0631\u0647\u0627\u06CC \u0628\u0631\u0631\u0633\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A\u0646\u062F." });
        return;
      }
      await withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE historical_work_records
           SET status = ?, is_seen_by_manager = 1, reviewed_by_user_id = ?, reviewed_at = NOW()
           WHERE id = ?`,
          [decision, req.user.id, recordId]
        );
        await recordAuditLog({
          actorUserId: req.user.id,
          actionType: "HISTORICAL_WORK_REVIEW",
          targetEntity: "historical_work_records",
          targetId: recordId,
          afterState: { status: decision },
          ipAddress: req.ip || null,
          connection: conn
        });
      });
      res.json({
        ok: true,
        message: decision === "APPROVED" ? "\u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F / \u0641\u0627\u06CC\u0644 \u0627\u06A9\u0633\u0644 \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F \u0648 \u0628\u0647 \u06A9\u0644 \u0645\u062D\u0627\u0633\u0628\u0627\u062A \u06A9\u0627\u0631\u06A9\u0631\u062F \u0648 \u0627\u0636\u0627\u0641\u0647\u200C\u06A9\u0627\u0631\u06CC \u0627\u0636\u0627\u0641\u0647 \u06AF\u0631\u062F\u06CC\u062F." : "\u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u0631\u062F \u0634\u062F."
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.put(
  "/historical-work/:id",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    const pool2 = getPool();
    try {
      const recordId = Number(req.params.id);
      if (!recordId) {
        res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u0631\u06A9\u0648\u0631\u062F \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A." });
        return;
      }
      const [existingRows] = await pool2.execute(
        "SELECT * FROM historical_work_records WHERE id = ?",
        [recordId]
      );
      if (existingRows.length === 0) {
        res.status(404).json({ ok: false, message: "\u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
        return;
      }
      const existing = mapRowToHistoricalWork(existingRows[0]);
      const shamsiDateRaw = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : existing.shamsi_date;
      if (!isValidShamsiDate(shamsiDateRaw)) {
        res.status(400).json({ ok: false, message: "\u062A\u0627\u0631\u06CC\u062E \u0634\u0645\u0633\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      const shamsiDate = normalizeShamsiDate(shamsiDateRaw);
      const workDate = shamsiToGregorian(shamsiDate);
      const title = req.body?.title ? String(req.body.title).trim() : existing.title;
      const workDaysCount = req.body?.work_days_count !== void 0 ? Math.max(0, Math.min(366, Math.round(Number(req.body.work_days_count) || 0))) : existing.work_days_count;
      let netWorkMinutes = existing.net_work_minutes;
      if (req.body?.net_work_minutes !== void 0) {
        netWorkMinutes = Math.max(0, Math.round(Number(req.body.net_work_minutes) || 0));
      } else if (req.body?.net_work_hours !== void 0 || req.body?.net_work_minutes_part !== void 0) {
        const nh = Math.max(0, Number(req.body?.net_work_hours || 0));
        const nm = Math.max(0, Math.min(59, Number(req.body?.net_work_minutes_part || 0)));
        netWorkMinutes = Math.round(nh * 60 + nm);
      }
      let overtimeMinutes = existing.overtime_minutes;
      if (req.body?.overtime_minutes !== void 0) {
        overtimeMinutes = Math.max(0, Math.round(Number(req.body.overtime_minutes) || 0));
      } else if (req.body?.overtime_hours !== void 0 || req.body?.overtime_minutes_part !== void 0) {
        const oh = Math.max(0, Number(req.body?.overtime_hours || 0));
        const om = Math.max(0, Math.min(59, Number(req.body?.overtime_minutes_part || 0)));
        overtimeMinutes = Math.round(oh * 60 + om);
      }
      const note = req.body?.note !== void 0 ? req.body.note ? String(req.body.note).trim() : null : existing.note;
      await withTransaction(async (conn) => {
        await conn.execute(
          `UPDATE historical_work_records
           SET shamsi_date = ?, work_date = ?, title = ?, work_days_count = ?, net_work_minutes = ?, overtime_minutes = ?, note = ?
           WHERE id = ?`,
          [shamsiDate, workDate, title, workDaysCount, netWorkMinutes, overtimeMinutes, note, recordId]
        );
        await recordAuditLog({
          actorUserId: req.user.id,
          actionType: "HISTORICAL_WORK_UPDATE",
          targetEntity: "historical_work_records",
          targetId: recordId,
          beforeState: {
            shamsi_date: existing.shamsi_date,
            work_days_count: existing.work_days_count,
            net_work_minutes: existing.net_work_minutes,
            overtime_minutes: existing.overtime_minutes
          },
          afterState: {
            shamsi_date: shamsiDate,
            work_days_count: workDaysCount,
            net_work_minutes: netWorkMinutes,
            overtime_minutes: overtimeMinutes
          },
          reason: String(req.body?.reason || "\u0627\u0635\u0644\u0627\u062D \u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u0642\u0628\u0644\u06CC \u062A\u0648\u0633\u0637 \u0645\u062F\u06CC\u0631\u06CC\u062A"),
          ipAddress: req.ip || null,
          connection: conn
        });
      });
      res.json({
        ok: true,
        message: "\u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u0642\u0628\u0644\u06CC \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0648\u06CC\u0631\u0627\u06CC\u0634 \u0634\u062F \u0648 \u06AF\u0632\u0627\u0631\u0634\u200C\u0647\u0627 \u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u06AF\u0631\u062F\u06CC\u062F\u0646\u062F."
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.delete(
  "/historical-work/:id",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const recordId = Number(req.params.id);
      if (!recordId) {
        res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u0631\u06A9\u0648\u0631\u062F \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A." });
        return;
      }
      await withTransaction(async (conn) => {
        const [rows] = await conn.execute(
          "SELECT * FROM historical_work_records WHERE id = ? FOR UPDATE",
          [recordId]
        );
        if (rows.length > 0) {
          const existing = mapRowToHistoricalWork(rows[0]);
          await conn.execute("DELETE FROM historical_work_records WHERE id = ?", [recordId]);
          await recordAuditLog({
            actorUserId: req.user.id,
            actionType: "HISTORICAL_WORK_DELETE",
            targetEntity: "historical_work_records",
            targetId: recordId,
            beforeState: {
              shamsi_date: existing.shamsi_date,
              title: existing.title,
              net_work_minutes: existing.net_work_minutes,
              overtime_minutes: existing.overtime_minutes
            },
            ipAddress: req.ip || null,
            connection: conn
          });
        }
      });
      res.json({ ok: true, message: "\u0633\u0627\u0628\u0642\u0647 \u06A9\u0627\u0631\u06A9\u0631\u062F \u0642\u0628\u0644\u06CC \u062D\u0630\u0641 \u0634\u062F." });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.post(
  "/attendance/manager-override",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const action = String(req.body?.action || "");
      const reason = String(req.body?.reason || "").trim() || "\u0627\u0635\u0644\u0627\u062D \u062A\u0648\u0633\u0637 \u0645\u062F\u06CC\u0631\u06CC\u062A";
      const workerId = await getWorkerUserId(pool2);
      const managerId = req.user.id;
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      await conn.execute(
        `SELECT id FROM users WHERE id = ? FOR UPDATE`,
        [workerId]
      );
      if (action === "ADD_SHIFT") {
        const shamsiDateRaw = String(req.body?.shamsi_date || "");
        if (!isValidShamsiDate(shamsiDateRaw)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: "\u062A\u0627\u0631\u06CC\u062E \u0648\u0627\u0631\u062F\u0634\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
          return;
        }
        const shamsiDate = normalizeShamsiDate(shamsiDateRaw);
        const workDate = shamsiToGregorian(shamsiDate);
        const checkInRaw = toEnglishDigits(String(req.body?.check_in_time || "")).trim();
        const checkOutRaw = toEnglishDigits(String(req.body?.check_out_time || "")).trim();
        const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
        if (!isValidTimeHHMMOrHHMMSS(checkInRaw, true) || !isValidTimeHHMMOrHHMMSS(checkOutRaw, true)) {
          await conn.rollback();
          res.status(400).json({
            ok: false,
            message: "\u0641\u0631\u0645\u062A \u0633\u0627\u0639\u062A \u0648\u0631\u0648\u062F \u0648 \u062E\u0631\u0648\u062C \u0628\u0627\u06CC\u062F \u0645\u0639\u062A\u0628\u0631 \u0648 \u0628\u06CC\u0646 00:00 \u062A\u0627 23:59 \u0628\u0627\u0634\u062F."
          });
          return;
        }
        const checkInTime = checkInRaw.length === 5 ? `${checkInRaw}:00` : checkInRaw;
        const checkOutTime = checkOutRaw.length === 5 ? `${checkOutRaw}:00` : checkOutRaw;
        if (parseTimeToMinutes(checkOutTime) <= parseTimeToMinutes(checkInTime)) {
          await conn.rollback();
          res.status(400).json({
            ok: false,
            message: "\u0633\u0627\u0639\u062A \u062E\u0627\u062A\u0645\u0647 \u06A9\u0627\u0631 (\u062E\u0631\u0648\u062C) \u0628\u0627\u06CC\u062F \u067E\u0633 \u0627\u0632 \u0633\u0627\u0639\u062A \u0622\u063A\u0627\u0632 \u0628\u0647 \u06A9\u0627\u0631 (\u0648\u0631\u0648\u062F) \u0628\u0627\u0634\u062F."
          });
          return;
        }
        const [dayRows] = await conn.execute(
          `SELECT * FROM attendance_logs WHERE user_id = ? AND work_date = ? AND is_deleted = 0 FOR UPDATE`,
          [workerId, workDate]
        );
        const simulatedLogs = [
          ...dayRows.map((r) => ({
            event_type: r.event_type,
            recorded_time: String(r.recorded_time)
          })),
          { event_type: "WORK_START", recorded_time: checkInTime },
          { event_type: "WORK_END", recorded_time: checkOutTime }
        ];
        const seqCheck = validateFullDayLogSequence(simulatedLogs);
        if (!seqCheck.valid) {
          await conn.rollback();
          res.status(400).json({
            ok: false,
            message: seqCheck.error
          });
          return;
        }
        const recordedAtIn = `${workDate} ${checkInTime}`;
        const recordedAtOut = `${workDate} ${checkOutTime}`;
        const [insIn] = await conn.execute(
          `INSERT INTO attendance_logs
            (user_id, work_date, shamsi_date, event_type, recorded_at, recorded_time, note, is_manual_override, modified_by_user_id, modification_reason, is_deleted)
           VALUES (?, ?, ?, 'WORK_START', ?, ?, ?, 1, ?, ?, 0)`,
          [workerId, workDate, shamsiDate, recordedAtIn, checkInTime, note, managerId, reason]
        );
        const [insOut] = await conn.execute(
          `INSERT INTO attendance_logs
            (user_id, work_date, shamsi_date, event_type, recorded_at, recorded_time, note, is_manual_override, modified_by_user_id, modification_reason, is_deleted)
           VALUES (?, ?, ?, 'WORK_END', ?, ?, ?, 1, ?, ?, 0)`,
          [workerId, workDate, shamsiDate, recordedAtOut, checkOutTime, note, managerId, reason]
        );
        await recordAuditLog({
          actorUserId: managerId,
          actionType: "ATTENDANCE_OVERRIDE",
          targetEntity: "attendance_logs",
          targetId: insIn.insertId,
          afterState: {
            action: "ADD_SHIFT",
            shamsi_date: shamsiDate,
            check_in_time: checkInTime,
            check_out_time: checkOutTime,
            check_in_log_id: insIn.insertId,
            check_out_log_id: insOut.insertId
          },
          reason,
          ipAddress: req.ip || null,
          connection: conn
        });
        await conn.commit();
        res.status(201).json({
          ok: true,
          message: "\u0646\u0648\u0628\u062A \u06A9\u0627\u0631\u06CC (\u0633\u0627\u0639\u062A \u0648\u0631\u0648\u062F \u0648 \u062E\u0631\u0648\u062C) \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062F\u0631 \u06A9\u0627\u0631\u06A9\u0631\u062F \u067E\u0631\u0633\u0646\u0644 \u062B\u0628\u062A \u06AF\u0631\u062F\u06CC\u062F."
        });
        return;
      }
      if (action === "ADD") {
        const shamsiDateRaw = String(req.body?.shamsi_date || "");
        if (!isValidShamsiDate(shamsiDateRaw)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: "\u062A\u0627\u0631\u06CC\u062E \u0648\u0627\u0631\u062F\u0634\u062F\u0647 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
          return;
        }
        const shamsiDate = normalizeShamsiDate(shamsiDateRaw);
        const workDate = shamsiToGregorian(shamsiDate);
        const eventType = String(req.body?.event_type || "");
        const recordedTimeRaw = toEnglishDigits(String(req.body?.recorded_time || "")).trim();
        const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
        if (!isValidTimeHHMMOrHHMMSS(recordedTimeRaw, true)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: "\u0641\u0631\u0645\u062A \u0633\u0627\u0639\u062A \u0628\u0627\u06CC\u062F \u0628\u06CC\u0646 00:00 \u062A\u0627 23:59 \u0628\u0627\u0634\u062F." });
          return;
        }
        const recordedTime = recordedTimeRaw.length === 5 ? `${recordedTimeRaw}:00` : recordedTimeRaw;
        const [dayRows] = await conn.execute(
          `SELECT * FROM attendance_logs WHERE user_id = ? AND work_date = ? AND is_deleted = 0 FOR UPDATE`,
          [workerId, workDate]
        );
        const simulatedLogs = [
          ...dayRows.map((r) => ({
            event_type: r.event_type,
            recorded_time: String(r.recorded_time)
          })),
          { event_type: eventType, recorded_time: recordedTime }
        ];
        const seqCheck = validateFullDayLogSequence(simulatedLogs);
        if (!seqCheck.valid) {
          await conn.rollback();
          res.status(400).json({
            ok: false,
            message: seqCheck.error
          });
          return;
        }
        const recordedAt = `${workDate} ${recordedTime}`;
        const [insLog] = await conn.execute(
          `INSERT INTO attendance_logs
            (user_id, work_date, shamsi_date, event_type, recorded_at, recorded_time, note, is_manual_override, modified_by_user_id, modification_reason, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`,
          [workerId, workDate, shamsiDate, eventType, recordedAt, recordedTime, note, managerId, reason]
        );
        await recordAuditLog({
          actorUserId: managerId,
          actionType: "ATTENDANCE_OVERRIDE",
          targetEntity: "attendance_logs",
          targetId: insLog.insertId,
          afterState: { action: "ADD", shamsi_date: shamsiDate, event_type: eventType, recorded_time: recordedTime },
          reason,
          ipAddress: req.ip || null,
          connection: conn
        });
        await conn.commit();
        res.status(201).json({
          ok: true,
          message: "\u0631\u0648\u06CC\u062F\u0627\u062F \u062A\u0631\u062F\u062F \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062F\u0631 \u0633\u0627\u0628\u0642\u0647 \u0631\u0648\u0632\u0627\u0646\u0647 \u062B\u0628\u062A \u06AF\u0631\u062F\u06CC\u062F."
        });
        return;
      }
      if (action === "UPDATE") {
        const logId = Number(req.body?.log_id);
        const newTimeRaw = toEnglishDigits(String(req.body?.recorded_time || "")).trim();
        const newEventType = String(req.body?.event_type || "");
        if (!logId || !isValidTimeHHMMOrHHMMSS(newTimeRaw, true)) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u0631\u06A9\u0648\u0631\u062F \u0648 \u0633\u0627\u0639\u062A \u0645\u0639\u062A\u0628\u0631 (00:00 \u062A\u0627 23:59) \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
          return;
        }
        const recordedTime = newTimeRaw.length === 5 ? `${newTimeRaw}:00` : newTimeRaw;
        const [targetRows] = await conn.execute(
          `SELECT * FROM attendance_logs WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
          [logId]
        );
        if (targetRows.length === 0) {
          await conn.rollback();
          res.status(404).json({ ok: false, message: "\u0631\u06A9\u0648\u0631\u062F \u062A\u0631\u062F\u062F \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
          return;
        }
        const targetLog = mapRowToAttendanceLog(targetRows[0]);
        const [dayRows] = await conn.execute(
          `SELECT * FROM attendance_logs WHERE user_id = ? AND work_date = ? AND is_deleted = 0 FOR UPDATE`,
          [targetLog.user_id, targetLog.work_date]
        );
        const simulatedLogs = dayRows.map(
          (r) => Number(r.id) === logId ? { event_type: newEventType, recorded_time: recordedTime } : { event_type: r.event_type, recorded_time: String(r.recorded_time) }
        );
        const seqCheck = validateFullDayLogSequence(simulatedLogs);
        if (!seqCheck.valid) {
          await conn.rollback();
          res.status(400).json({ ok: false, message: seqCheck.error });
          return;
        }
        const recordedAt = `${targetLog.work_date} ${recordedTime}`;
        await conn.execute(
          `UPDATE attendance_logs
           SET event_type = ?, recorded_time = ?, recorded_at = ?, is_manual_override = 1, modified_by_user_id = ?, modification_reason = ?
           WHERE id = ?`,
          [newEventType, recordedTime, recordedAt, managerId, reason, logId]
        );
        await recordAuditLog({
          actorUserId: managerId,
          actionType: "ATTENDANCE_OVERRIDE",
          targetEntity: "attendance_logs",
          targetId: logId,
          beforeState: { event_type: targetLog.event_type, recorded_time: targetLog.recorded_time },
          afterState: { event_type: newEventType, recorded_time: recordedTime },
          reason,
          ipAddress: req.ip || null,
          connection: conn
        });
        await conn.commit();
        res.json({
          ok: true,
          message: "\u0627\u0635\u0644\u0627\u062D \u062A\u0631\u062F\u062F \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F."
        });
        return;
      }
      if (action === "DELETE") {
        const logId = Number(req.body?.log_id);
        const [targetRows] = await conn.execute(
          `SELECT * FROM attendance_logs WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
          [logId]
        );
        if (targetRows.length === 0) {
          await conn.rollback();
          res.status(404).json({ ok: false, message: "\u0631\u06A9\u0648\u0631\u062F \u062A\u0631\u062F\u062F \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
          return;
        }
        const targetLog = mapRowToAttendanceLog(targetRows[0]);
        const [dayRows] = await conn.execute(
          `SELECT * FROM attendance_logs WHERE user_id = ? AND work_date = ? AND is_deleted = 0 FOR UPDATE`,
          [targetLog.user_id, targetLog.work_date]
        );
        const remainingLogs = dayRows.filter((r) => Number(r.id) !== logId).map((r) => ({
          event_type: r.event_type,
          recorded_time: String(r.recorded_time)
        }));
        const seqCheck = validateFullDayLogSequence(remainingLogs);
        if (!seqCheck.valid) {
          await conn.rollback();
          res.status(400).json({
            ok: false,
            message: `\u062D\u0630\u0641 \u0627\u06CC\u0646 \u0631\u06A9\u0648\u0631\u062F \u0645\u0648\u062C\u0628 \u0646\u0627\u0633\u0627\u0632\u06AF\u0627\u0631\u06CC \u062A\u0648\u0627\u0644\u06CC \u062A\u0631\u062F\u062F\u0647\u0627\u06CC \u0631\u0648\u0632 \u0645\u06CC\u200C\u0634\u0648\u062F: ${seqCheck.error}`
          });
          return;
        }
        await conn.execute(
          `UPDATE attendance_logs
           SET is_deleted = 1, is_manual_override = 1, modified_by_user_id = ?, modification_reason = ?
           WHERE id = ?`,
          [managerId, reason, logId]
        );
        await recordAuditLog({
          actorUserId: managerId,
          actionType: "ATTENDANCE_OVERRIDE",
          targetEntity: "attendance_logs",
          targetId: logId,
          beforeState: { event_type: targetLog.event_type, recorded_time: targetLog.recorded_time },
          afterState: { is_deleted: true },
          reason,
          ipAddress: req.ip || null,
          connection: conn
        });
        await conn.commit();
        res.json({
          ok: true,
          message: "\u0631\u06A9\u0648\u0631\u062F \u062A\u0631\u062F\u062F \u062D\u0630\u0641 \u0634\u062F."
        });
        return;
      }
      await conn.rollback();
      res.status(400).json({ ok: false, message: "\u0646\u0648\u0639 \u0639\u0645\u0644\u06CC\u0627\u062A \u0627\u0635\u0644\u0627\u062D \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A." });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.post(
  "/attendance/review-late",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const logId = req.body?.log_id ? Number(req.body.log_id) : 0;
      const shamsiRaw = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : "";
      const decision = String(req.body?.decision || "").trim();
      const managerNote = req.body?.manager_note ? String(req.body.manager_note).trim().slice(0, 500) : null;
      const customDeductionRaw = req.body?.custom_deduction_toman;
      const customDeductionToman = customDeductionRaw !== void 0 && customDeductionRaw !== null && String(customDeductionRaw).trim() !== "" ? Math.max(
        0,
        Math.round(
          Number(toEnglishDigits(String(customDeductionRaw)).replace(/,/g, "").trim()) || 0
        )
      ) : null;
      const validDecisions = [
        "EXCUSED",
        "APPROVED_DELAY",
        "ABSENCE",
        "DEDUCT_LEAVE",
        "CUSTOM"
      ];
      if (!validDecisions.includes(decision)) {
        res.status(400).json({
          ok: false,
          message: "\u0646\u0648\u0639 \u062A\u0635\u0645\u06CC\u0645 \u0645\u062F\u06CC\u0631\u06CC\u062A \u0628\u0631\u0627\u06CC \u062A\u0639\u06CC\u06CC\u0646 \u062A\u06A9\u0644\u06CC\u0641 \u062A\u0623\u062E\u06CC\u0631 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A."
        });
        return;
      }
      const workerId = await getWorkerUserId(pool2);
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      let targetRow = null;
      if (logId > 0) {
        const [rows] = await conn.execute(
          `SELECT * FROM attendance_logs WHERE id = ? AND user_id = ? AND is_deleted = 0 FOR UPDATE`,
          [logId, workerId]
        );
        if (rows.length > 0) {
          targetRow = rows[0];
        }
      } else if (shamsiRaw && isValidShamsiDate(shamsiRaw)) {
        const normShamsi = normalizeShamsiDate(shamsiRaw);
        const [rows] = await conn.execute(
          `SELECT * FROM attendance_logs
           WHERE user_id = ? AND shamsi_date = ? AND is_deleted = 0
           ORDER BY recorded_time ASC, id ASC
           LIMIT 1 FOR UPDATE`,
          [workerId, normShamsi]
        );
        if (rows.length > 0) {
          targetRow = rows[0];
        }
      }
      if (!targetRow) {
        await conn.rollback();
        res.status(404).json({
          ok: false,
          message: "\u0631\u06A9\u0648\u0631\u062F \u0648\u0631\u0648\u062F \u067E\u0631\u0633\u0646\u0644 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u062A\u0627\u0631\u06CC\u062E \u06CC\u0627\u0641\u062A \u0646\u0634\u062F."
        });
        return;
      }
      const targetLog = mapRowToAttendanceLog(targetRow);
      const effectiveSettings = await getSystemSettingsFromDb(targetLog.shamsi_date);
      const dayOfWeek = getDayOfWeekFromGregorian(targetLog.work_date);
      const { shiftStartHHMM, shiftStartMin } = getDayShiftSchedule(dayOfWeek, effectiveSettings);
      const firstInMin = parseTimeToMinutes(targetLog.recorded_time);
      const rawLateMins = Math.max(0, firstInMin - shiftStartMin);
      await conn.execute(
        `UPDATE attendance_logs
         SET late_status = ?,
             manager_late_note = ?,
             custom_deduction_toman = ?,
             late_reviewed_by_user_id = ?,
             late_reviewed_at = NOW(),
             is_late_seen_by_worker = 0
         WHERE id = ?`,
        [
          decision,
          managerNote,
          decision === "CUSTOM" ? customDeductionToman : null,
          req.user.id,
          targetLog.id
        ]
      );
      const leaveIdempotencyKey = `late_leave_log_${targetLog.id}`;
      if (decision === "DEDUCT_LEAVE" && rawLateMins > 0) {
        const [existingLeave] = await conn.execute(
          `SELECT id FROM leave_requests WHERE idempotency_key = ? LIMIT 1`,
          [leaveIdempotencyKey]
        );
        const leaveReasonText = `\u06A9\u0633\u0631 \u0627\u0632 \u0645\u0631\u062E\u0635\u06CC \u0628\u0627\u0628\u062A ${toPersianDigits(rawLateMins)} \u062F\u0642\u06CC\u0642\u0647 \u062A\u0623\u062E\u06CC\u0631 \u062F\u0631 \u0648\u0631\u0648\u062F (${targetLog.late_reason || "\u0628\u0627 \u062A\u0635\u0645\u06CC\u0645 \u0645\u062F\u06CC\u0631\u06CC\u062A"})`;
        if (existingLeave.length > 0) {
          await conn.execute(
            `UPDATE leave_requests
             SET duration_minutes = ?, start_time = ?, end_time = ?, reason = ?, manager_note = ?, status = 'APPROVED', reviewed_by_user_id = ?, reviewed_at = NOW()
             WHERE id = ?`,
            [
              rawLateMins,
              shiftStartHHMM,
              targetLog.recorded_time.slice(0, 5),
              leaveReasonText,
              managerNote,
              req.user.id,
              existingLeave[0].id
            ]
          );
        } else {
          await conn.execute(
            `INSERT INTO leave_requests
              (user_id, shamsi_date, work_date, leave_type, start_time, end_time, duration_minutes, reason, status, is_seen_by_manager, manager_note, reviewed_by_user_id, reviewed_at, idempotency_key)
             VALUES (?, ?, ?, 'HOURLY', ?, ?, ?, ?, 'APPROVED', 1, ?, ?, NOW(), ?)`,
            [
              workerId,
              targetLog.shamsi_date,
              targetLog.work_date,
              shiftStartHHMM,
              targetLog.recorded_time.slice(0, 5),
              rawLateMins,
              leaveReasonText,
              managerNote,
              req.user.id,
              leaveIdempotencyKey
            ]
          );
        }
      } else {
        await conn.execute(`DELETE FROM leave_requests WHERE idempotency_key = ?`, [
          leaveIdempotencyKey
        ]);
      }
      await recordAuditLog({
        actorUserId: req.user.id,
        actionType: "ATTENDANCE_LATE_REVIEW",
        targetEntity: "attendance_logs",
        targetId: targetLog.id,
        beforeState: {
          late_status: targetLog.late_status,
          manager_late_note: targetLog.manager_late_note
        },
        afterState: {
          shamsi_date: targetLog.shamsi_date,
          late_status: decision,
          manager_late_note: managerNote,
          custom_deduction_toman: decision === "CUSTOM" ? customDeductionToman : null
        },
        reason: managerNote || "\u062A\u0639\u06CC\u06CC\u0646 \u062A\u06A9\u0644\u06CC\u0641 \u062A\u0623\u062E\u06CC\u0631 \u062F\u0631 \u0648\u0631\u0648\u062F \u062A\u0648\u0633\u0637 \u0645\u062F\u06CC\u0631\u06CC\u062A",
        ipAddress: req.ip || null,
        connection: conn
      });
      await conn.commit();
      const decisionLabels = {
        NONE: "\u0639\u0627\u062F\u06CC",
        PENDING: "\u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631 \u0628\u0631\u0631\u0633\u06CC",
        EXCUSED: "\u062B\u0628\u062A \u0628\u062F\u0648\u0646 \u062A\u0623\u062E\u06CC\u0631 (\u0628\u062E\u0634\u0634 \u062A\u0623\u062E\u06CC\u0631)",
        APPROVED_DELAY: "\u062B\u0628\u062A \u0628\u0627 \u062A\u0623\u062E\u06CC\u0631 (\u06A9\u0633\u0631 \u0627\u0632 \u062D\u0642\u0648\u0642 \u0637\u0628\u0642 \u062A\u0639\u0631\u0641\u0647)",
        ABSENCE: "\u062B\u0628\u062A \u063A\u06CC\u0628\u062A \u0631\u0648\u0632\u0627\u0646\u0647",
        DEDUCT_LEAVE: "\u06A9\u0633\u0631 \u0645\u062F\u062A \u062A\u0623\u062E\u06CC\u0631 \u0627\u0632 \u0633\u0647\u0645\u06CC\u0647 \u0645\u0631\u062E\u0635\u06CC",
        CUSTOM: "\u062A\u0639\u06CC\u06CC\u0646 \u062A\u06A9\u0644\u06CC\u0641 \u0648 \u062C\u0631\u06CC\u0645\u0647 \u0633\u0641\u0627\u0631\u0634\u06CC"
      };
      res.json({
        ok: true,
        decision,
        message: `\u062A\u0635\u0645\u06CC\u0645 \u0645\u062F\u06CC\u0631\u06CC\u062A (\xAB${decisionLabels[decision]}\xBB) \u062B\u0628\u062A \u0634\u062F \u0648 \u0646\u062A\u06CC\u062C\u0647 \u0628\u0647 \u0647\u0645\u0631\u0627\u0647 \u06CC\u0627\u062F\u062F\u0627\u0634\u062A \u0628\u0631\u0627\u06CC \u067E\u0631\u0633\u0646\u0644 \u0627\u0631\u0633\u0627\u0644 \u06AF\u0631\u062F\u06CC\u062F.`
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.post(
  "/attendance/ack-late-decision",
  requireAuth,
  async (req, res) => {
    try {
      const pool2 = getPool();
      const logId = req.body?.log_id ? Number(req.body.log_id) : null;
      if (logId) {
        await pool2.execute(
          `UPDATE attendance_logs SET is_late_seen_by_worker = 1 WHERE id = ? AND user_id = ?`,
          [logId, req.user.id]
        );
      } else {
        await pool2.execute(
          `UPDATE attendance_logs SET is_late_seen_by_worker = 1 WHERE user_id = ? AND is_late_seen_by_worker = 0`,
          [req.user.id]
        );
      }
      res.json({ ok: true });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get("/reports", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const workerId = await resolveTargetWorkerId(pool2, req, res);
    if (workerId === null) return;
    const search = req.query.search ? String(req.query.search).trim() : "";
    const shamsiDate = req.query.shamsiDate ? normalizeShamsiDate(String(req.query.shamsiDate)) : "";
    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : "";
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : "";
    let sql = `SELECT * FROM daily_work_reports WHERE user_id = ?`;
    const params = [workerId];
    if (shamsiDate) {
      sql += ` AND shamsi_date = ?`;
      params.push(shamsiDate);
    }
    if (fromShamsi) {
      sql += ` AND shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND shamsi_date <= ?`;
      params.push(toShamsi);
    }
    if (search) {
      sql += ` AND activity_description LIKE ?`;
      params.push(`%${search}%`);
    }
    sql += ` ORDER BY report_date DESC, id DESC LIMIT 300`;
    const [rows] = await pool2.execute(sql, params);
    const reports = rows.map((r) => ({
      id: Number(r.id),
      user_id: Number(r.user_id),
      report_date: extractSqlDateString(r.report_date, r.shamsi_date),
      shamsi_date: String(r.shamsi_date),
      activity_description: String(r.activity_description),
      duration_minutes: r.duration_minutes !== null ? Number(r.duration_minutes) : null,
      photo_url: r.photo_url ? String(r.photo_url) : null,
      photo_name: r.photo_name ? String(r.photo_name) : null,
      recorded_time: String(r.recorded_time),
      is_seen_by_manager: Boolean(r.is_seen_by_manager),
      created_at: r.created_at ? rowCreatedAt(r) : ""
    }));
    res.json({ ok: true, reports });
  } catch (err) {
    handleServerError(res, err);
  }
});
function rowCreatedAt(r) {
  return r.created_at ? new Date(r.created_at).toISOString() : (/* @__PURE__ */ new Date()).toISOString();
}
apiRouter.post(
  "/reports",
  requireAuth,
  requireRole("worker"),
  async (req, res) => {
    try {
      const description = String(req.body?.activity_description || "").trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : "";
      const durationRaw = req.body?.duration_minutes;
      const photoBase64 = req.body?.photo_base64 ? String(req.body.photo_base64) : null;
      const photoName = req.body?.photo_name ? String(req.body.photo_name) : "work-photo.jpg";
      if (!description || description.length < 3) {
        res.status(400).json({
          ok: false,
          message: "\u0634\u0631\u062D \u0641\u0639\u0627\u0644\u06CC\u062A \u06AF\u0632\u0627\u0631\u0634 \u0631\u0648\u0632\u0627\u0646\u0647 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A."
        });
        return;
      }
      let durationMinutes = null;
      if (durationRaw !== void 0 && durationRaw !== null && String(durationRaw).trim() !== "") {
        const parsed = Number(toEnglishDigits(String(durationRaw)));
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 1440) {
          res.status(400).json({
            ok: false,
            message: "\u0645\u062F\u062A \u0632\u0645\u0627\u0646 \u0635\u0631\u0641\u200C\u0634\u062F\u0647 \u0628\u0627\u06CC\u062F \u0639\u062F\u062F\u06CC \u0628\u06CC\u0646 \u06F1 \u062A\u0627 \u06F1\u06F4\u06F4\u06F0 \u062F\u0642\u06CC\u0642\u0647 \u0628\u0627\u0634\u062F."
          });
          return;
        }
        durationMinutes = Math.round(parsed);
      }
      let savedPhotoUrl = null;
      if (photoBase64 && photoBase64.trim() !== "") {
        const saved = saveBase64MediaFile("reports", photoName, photoBase64);
        savedPhotoUrl = saved.publicUrl;
      }
      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const reportDate = shamsiToGregorian(shamsiDate);
      const pool2 = getPool();
      const [result] = await pool2.execute(
        `INSERT INTO daily_work_reports
          (user_id, report_date, shamsi_date, activity_description, duration_minutes, photo_url, photo_name, recorded_time, is_seen_by_manager)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          req.user.id,
          reportDate,
          shamsiDate,
          description,
          durationMinutes,
          savedPhotoUrl,
          savedPhotoUrl ? photoName : null,
          nowInfo.timeHHMMSS
        ]
      );
      res.status(201).json({
        ok: true,
        reportId: result.insertId,
        message: "\u06AF\u0632\u0627\u0631\u0634 \u06A9\u0627\u0631 \u0631\u0648\u0632\u0627\u0646\u0647 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u0628\u0631\u0627\u06CC \u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u0634\u062F."
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get("/tasks", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const workerId = await resolveTargetWorkerId(pool2, req, res);
    if (workerId === null) return;
    const shamsiDate = req.query.shamsiDate ? normalizeShamsiDate(String(req.query.shamsiDate)) : "";
    let sql = "SELECT * FROM work_tasks WHERE user_id = ?";
    const params = [workerId];
    if (shamsiDate) {
      sql += " AND shamsi_date = ?";
      params.push(shamsiDate);
    }
    sql += " ORDER BY is_completed ASC, id DESC LIMIT 150";
    const [rows] = await pool2.execute(sql, params);
    res.json({
      ok: true,
      tasks: rows.map(mapRowToWorkTask)
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/tasks", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const description = req.body?.description ? String(req.body.description).trim().slice(0, 500) : null;
    const shamsiRaw = String(req.body?.shamsi_date || "").trim();
    const sendSmsOverride = Boolean(req.body?.send_sms);
    if (!title) {
      res.status(400).json({ ok: false, message: "\u0639\u0646\u0648\u0627\u0646 \u0648\u0638\u06CC\u0641\u0647 / \u06A9\u0627\u0631 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
      return;
    }
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const shamsiDate = shamsiRaw && isValidShamsiDate(shamsiRaw) ? normalizeShamsiDate(shamsiRaw) : nowInfo.shamsiDate;
    const pool2 = getPool();
    const workerInfo = await getWorkerInfo(pool2);
    const workerId = workerInfo.id;
    const [ins] = await pool2.execute(
      `INSERT INTO work_tasks (user_id, created_by_user_id, shamsi_date, title, description, is_completed, added_to_report)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [workerId, req.user.id, shamsiDate, title, description]
    );
    let smsSent = false;
    const targetPhone = settings.worker_phone_number || workerInfo.phone_number || "";
    if (targetPhone && settings.melipayamak_username && settings.melipayamak_password && (sendSmsOverride || settings.sms_enabled && settings.sms_on_task_and_message)) {
      const smsText = `\u0648\u0638\u06CC\u0641\u0647 \u062C\u062F\u06CC\u062F \u0627\u0632 \u0637\u0631\u0641 \u0645\u062F\u06CC\u0631\u06CC\u062A (\u0645\u062C\u06CC\u062F \u0646\u0648\u0631\u0627\u06CC\u06CC):
${title}${description ? `
${description}` : ""}`;
      const smsRes = await sendMelipayamakSms(settings, targetPhone, smsText);
      smsSent = smsRes.sent;
    }
    res.status(201).json({
      ok: true,
      id: ins.insertId,
      smsSent,
      message: smsSent ? "\u0648\u0638\u06CC\u0641\u0647 \u06A9\u0627\u0631\u06CC \u062C\u062F\u06CC\u062F \u0628\u0647 \u0686\u06A9\u200C\u0644\u06CC\u0633\u062A \u067E\u0631\u0633\u0646\u0644 \u0627\u0636\u0627\u0641\u0647 \u0634\u062F \u0648 \u0646\u0648\u062A\u06CC\u0641\u06CC\u06A9\u06CC\u0634\u0646 + \u067E\u06CC\u0627\u0645\u06A9 \u0627\u0631\u0633\u0627\u0644 \u06AF\u0631\u062F\u06CC\u062F." : "\u0648\u0638\u06CC\u0641\u0647 \u06A9\u0627\u0631\u06CC \u062C\u062F\u06CC\u062F \u062B\u0628\u062A \u0634\u062F \u0648 \u0627\u0639\u0644\u0627\u0646 \u0622\u0646 \u062F\u0631 \u06AF\u0648\u0634\u06CC \u067E\u0631\u0633\u0646\u0644 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.patch("/tasks/:id/toggle", requireAuth, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    if (!taskId) {
      res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
      return;
    }
    const pool2 = getPool();
    const [rows] = await pool2.execute(
      "SELECT * FROM work_tasks WHERE id = ? LIMIT 1",
      [taskId]
    );
    if (rows.length === 0) {
      res.status(404).json({ ok: false, message: "\u0645\u0648\u0631\u062F \u06A9\u0627\u0631\u06CC \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
      return;
    }
    if (req.user.role !== "manager" && Number(rows[0].user_id) !== req.user.id) {
      res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "\u0634\u0645\u0627 \u0645\u062C\u0648\u0632 \u062A\u063A\u06CC\u06CC\u0631 \u0648\u0638\u06CC\u0641\u0647 \u06A9\u0627\u0631\u0628\u0631 \u062F\u06CC\u06AF\u0631 \u0631\u0627 \u0646\u062F\u0627\u0631\u06CC\u062F."
      });
      return;
    }
    const currentCompleted = Boolean(rows[0].is_completed);
    const nextCompleted = req.body?.is_completed !== void 0 ? Boolean(req.body.is_completed) : !currentCompleted;
    const addedToReport = req.body?.added_to_report !== void 0 ? Boolean(req.body.added_to_report) : Boolean(rows[0].added_to_report);
    await pool2.execute(
      `UPDATE work_tasks
       SET is_completed = ?, completed_at = ?, added_to_report = ?
       WHERE id = ?`,
      [nextCompleted ? 1 : 0, nextCompleted ? /* @__PURE__ */ new Date() : null, addedToReport ? 1 : 0, taskId]
    );
    res.json({
      ok: true,
      is_completed: nextCompleted,
      message: nextCompleted ? "\u0627\u0646\u062C\u0627\u0645 \u06A9\u0627\u0631 \u062B\u0628\u062A \u0634\u062F." : "\u0648\u0636\u0639\u06CC\u062A \u06A9\u0627\u0631 \u0628\u0647 \u062D\u0627\u0644\u062A \u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631 \u062A\u063A\u06CC\u06CC\u0631 \u06CC\u0627\u0641\u062A."
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.delete("/tasks/:id", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const pool2 = getPool();
    await pool2.execute("DELETE FROM work_tasks WHERE id = ?", [taskId]);
    res.json({ ok: true, message: "\u0645\u0648\u0631\u062F \u06A9\u0627\u0631\u06CC \u0627\u0632 \u0686\u06A9\u200C\u0644\u06CC\u0633\u062A \u062D\u0630\u0641 \u0634\u062F." });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post(
  "/manager/mark-seen",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const section = String(req.body?.section || "");
      const pool2 = getPool();
      if (section === "reports") {
        await pool2.execute("UPDATE daily_work_reports SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0");
      } else if (section === "finance") {
        await pool2.execute("UPDATE financial_transactions SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0");
      } else if (section === "historical") {
        await pool2.execute("UPDATE historical_work_records SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0");
      } else if (section === "leaves") {
        await pool2.execute("UPDATE leave_requests SET is_seen_by_manager = 1 WHERE is_seen_by_manager = 0");
      }
      res.json({ ok: true });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get("/finance", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const workerId = await resolveTargetWorkerId(pool2, req, res);
    if (workerId === null) return;
    const statusFilter = req.query.status ? String(req.query.status).trim() : "";
    const typeFilter = req.query.txType ? String(req.query.txType).trim() : "";
    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : "";
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : "";
    const search = req.query.search ? String(req.query.search).trim() : "";
    let sql = `
      SELECT f.*, u.role AS creator_role, u.full_name AS creator_name
      FROM financial_transactions f
      INNER JOIN users u ON u.id = f.created_by_user_id
      WHERE f.user_id = ?
    `;
    const params = [workerId];
    if (statusFilter && ["PENDING", "APPROVED", "REJECTED"].includes(statusFilter)) {
      sql += ` AND f.status = ?`;
      params.push(statusFilter);
    }
    if (typeFilter && ["ADVANCE", "ON_ACCOUNT", "SALARY", "PETTY_CASH", "OTHER"].includes(typeFilter)) {
      sql += ` AND f.tx_type = ?`;
      params.push(typeFilter);
    }
    if (fromShamsi) {
      sql += ` AND f.shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND f.shamsi_date <= ?`;
      params.push(toShamsi);
    }
    if (search) {
      sql += ` AND (f.description LIKE ? OR f.manager_note LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY f.tx_date DESC, f.id DESC LIMIT 400`;
    const [rows] = await pool2.execute(sql, params);
    const transactions = rows.map(mapRowToFinancialTx);
    const [totalsRows] = await pool2.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
         COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_total,
         COALESCE(SUM(CASE WHEN status = 'APPROVED' AND tx_type IN ('PETTY_CASH', 'OTHER') THEN amount_toman ELSE 0 END), 0) AS approved_petty_cash_total,
         COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_count
       FROM financial_transactions
       WHERE user_id = ?`,
      [workerId]
    );
    res.json({
      ok: true,
      transactions,
      summary: {
        approvedTotalToman: Number(totalsRows[0]?.approved_total || 0),
        pendingTotalToman: Number(totalsRows[0]?.pending_total || 0),
        approvedPettyCashToman: Number(totalsRows[0]?.approved_petty_cash_total || 0),
        pendingCount: Number(totalsRows[0]?.pending_count || 0)
      }
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post(
  "/finance/worker-request",
  requireAuth,
  requireRole("worker"),
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const rawAmount = toEnglishDigits(String(req.body?.amount_toman || "")).replace(/,/g, "").trim();
      const amountToman = Number(rawAmount);
      const txType = String(req.body?.tx_type || "");
      const description = String(req.body?.description || "").trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : "";
      const receiptBase64 = req.body?.receipt_base64 ? String(req.body.receipt_base64) : null;
      const receiptFileName = req.body?.receipt_file_name ? String(req.body.receipt_file_name) : "receipt.jpg";
      const rawIdempotency = req.body?.idempotency_key || req.headers["x-idempotency-key"] || null;
      const idempotencyKey = rawIdempotency ? String(rawIdempotency).trim().slice(0, 64) : null;
      if (!Number.isInteger(amountToman) || amountToman <= 0) {
        res.status(400).json({
          ok: false,
          message: "\u0645\u0628\u0644\u063A \u0628\u0627\u06CC\u062F \u06CC\u06A9 \u0639\u062F\u062F \u0635\u062D\u06CC\u062D \u0645\u062B\u0628\u062A \u0628\u0647 \u062A\u0648\u0645\u0627\u0646 \u0628\u0627\u0634\u062F."
        });
        return;
      }
      const validTypes = ["ADVANCE", "ON_ACCOUNT", "SALARY", "PETTY_CASH", "OTHER"];
      if (!validTypes.includes(txType)) {
        res.status(400).json({
          ok: false,
          message: "\u0646\u0648\u0639 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0627\u0644\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A."
        });
        return;
      }
      if (!description || description.length < 2) {
        res.status(400).json({
          ok: false,
          message: "\u062B\u0628\u062A \u0634\u0631\u062D \u0648 \u062C\u0632\u0626\u06CC\u0627\u062A \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A."
        });
        return;
      }
      let savedReceiptUrl = null;
      if (receiptBase64 && receiptBase64.trim() !== "") {
        const saved = saveBase64MediaFile("receipts", receiptFileName, receiptBase64);
        savedReceiptUrl = saved.publicUrl;
      }
      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const txDate = shamsiToGregorian(shamsiDate);
      const workerId = req.user.id;
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      await conn.execute(
        `SELECT id FROM users WHERE id = ? FOR UPDATE`,
        [workerId]
      );
      if (idempotencyKey) {
        const [dupRows] = await conn.execute(
          `SELECT id FROM financial_transactions WHERE idempotency_key = ? LIMIT 1`,
          [idempotencyKey]
        );
        if (dupRows.length > 0) {
          await conn.rollback();
          res.status(409).json({
            ok: false,
            code: "DUPLICATE_REQUEST",
            message: "\u0627\u06CC\u0646 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A."
          });
          return;
        }
      }
      const [result] = await conn.execute(
        `INSERT INTO financial_transactions
          (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, receipt_file_url, receipt_file_name, status, is_seen_by_manager, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
        [
          workerId,
          workerId,
          amountToman,
          txType,
          txDate,
          shamsiDate,
          description,
          savedReceiptUrl,
          savedReceiptUrl ? receiptFileName : null,
          idempotencyKey
        ]
      );
      await recordAuditLog({
        actorUserId: workerId,
        actionType: "FINANCE_WORKER_REQUEST",
        targetEntity: "financial_transactions",
        targetId: result.insertId,
        afterState: {
          amount_toman: amountToman,
          tx_type: txType,
          shamsi_date: shamsiDate,
          status: "PENDING"
        },
        ipAddress: req.ip || null,
        connection: conn
      });
      if (getSimulatedMidTransactionFailure() === "finance_payment") {
        throw new Error("SIMULATED_DB_DISCONNECT");
      }
      await conn.commit();
      res.status(201).json({
        ok: true,
        transactionId: result.insertId,
        message: txType === "PETTY_CASH" ? "\u0647\u0632\u06CC\u0646\u0647 \u062A\u0646\u062E\u0648\u0627\u0647 / \u062E\u0631\u06CC\u062F \u06A9\u0627\u0631\u06AF\u0627\u0647\u06CC \u062B\u0628\u062A \u0634\u062F \u0648 \u0628\u0631\u0627\u06CC \u062A\u0623\u06CC\u06CC\u062F \u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u06AF\u0631\u062F\u06CC\u062F." : "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0627\u0644\u06CC \u062B\u0628\u062A \u0634\u062F \u0648 \u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631 \u062A\u0623\u06CC\u06CC\u062F \u0645\u062F\u06CC\u0631\u06CC\u062A \u0642\u0631\u0627\u0631 \u06AF\u0631\u0641\u062A."
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      const errObj = err;
      if (errObj?.code === "ER_DUP_ENTRY") {
        res.status(409).json({
          ok: false,
          code: "DUPLICATE_REQUEST",
          message: "\u0627\u06CC\u0646 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A."
        });
        return;
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.post(
  "/finance/manager-direct",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const rawAmount = toEnglishDigits(String(req.body?.amount_toman || "")).replace(/,/g, "").trim();
      const amountToman = Number(rawAmount);
      const txType = String(req.body?.tx_type || "");
      const description = String(req.body?.description || "").trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : "";
      const receiptBase64 = req.body?.receipt_base64 ? String(req.body.receipt_base64) : null;
      const receiptFileName = req.body?.receipt_file_name ? String(req.body.receipt_file_name) : "receipt.jpg";
      const rawIdempotency = req.body?.idempotency_key || req.headers["x-idempotency-key"] || null;
      const idempotencyKey = rawIdempotency ? String(rawIdempotency).trim().slice(0, 64) : null;
      if (!Number.isInteger(amountToman) || amountToman <= 0) {
        res.status(400).json({ ok: false, message: "\u0645\u0628\u0644\u063A \u067E\u0631\u062F\u0627\u062E\u062A \u0628\u0627\u06CC\u062F \u06CC\u06A9 \u0639\u062F\u062F \u0635\u062D\u06CC\u062D \u0645\u062B\u0628\u062A \u0628\u0647 \u062A\u0648\u0645\u0627\u0646 \u0628\u0627\u0634\u062F." });
        return;
      }
      const validTypes = ["ADVANCE", "ON_ACCOUNT", "SALARY", "PETTY_CASH", "OTHER"];
      if (!validTypes.includes(txType)) {
        res.status(400).json({ ok: false, message: "\u0646\u0648\u0639 \u067E\u0631\u062F\u0627\u062E\u062A \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      if (!description) {
        res.status(400).json({ ok: false, message: "\u062B\u0628\u062A \u0634\u0631\u062D \u067E\u0631\u062F\u0627\u062E\u062A \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
        return;
      }
      let savedReceiptUrl = null;
      if (receiptBase64 && receiptBase64.trim() !== "") {
        const saved = saveBase64MediaFile("receipts", receiptFileName, receiptBase64);
        savedReceiptUrl = saved.publicUrl;
      }
      const settings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(settings.timezone);
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : nowInfo.shamsiDate;
      const txDate = shamsiToGregorian(shamsiDate);
      const workerId = await getWorkerUserId(pool2);
      const managerId = req.user.id;
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      await conn.execute(
        `SELECT id FROM users WHERE id = ? FOR UPDATE`,
        [workerId]
      );
      if (idempotencyKey) {
        const [dupRows] = await conn.execute(
          `SELECT id FROM financial_transactions WHERE idempotency_key = ? LIMIT 1`,
          [idempotencyKey]
        );
        if (dupRows.length > 0) {
          await conn.rollback();
          res.status(409).json({
            ok: false,
            code: "DUPLICATE_REQUEST",
            message: "\u0627\u06CC\u0646 \u067E\u0631\u062F\u0627\u062E\u062A \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A."
          });
          return;
        }
      }
      const managerNoteInput = req.body?.manager_note ? String(req.body.manager_note).trim().slice(0, 500) : "\u062B\u0628\u062A \u0645\u0633\u062A\u0642\u06CC\u0645 \u062A\u0648\u0633\u0637 \u0645\u062F\u06CC\u0631\u06CC\u062A";
      const [result] = await conn.execute(
        `INSERT INTO financial_transactions
          (user_id, created_by_user_id, amount_toman, tx_type, tx_date, shamsi_date, description, receipt_file_url, receipt_file_name, status, is_seen_by_manager, reviewed_by_user_id, reviewed_at, manager_note, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 1, ?, NOW(), ?, ?)`,
        [
          workerId,
          managerId,
          amountToman,
          txType,
          txDate,
          shamsiDate,
          description,
          savedReceiptUrl,
          savedReceiptUrl ? receiptFileName : null,
          managerId,
          managerNoteInput || "\u062B\u0628\u062A \u0645\u0633\u062A\u0642\u06CC\u0645 \u062A\u0648\u0633\u0637 \u0645\u062F\u06CC\u0631\u06CC\u062A",
          idempotencyKey
        ]
      );
      await recordAuditLog({
        actorUserId: managerId,
        actionType: "FINANCE_MANAGER_DIRECT",
        targetEntity: "financial_transactions",
        targetId: result.insertId,
        afterState: {
          amount_toman: amountToman,
          tx_type: txType,
          shamsi_date: shamsiDate,
          status: "APPROVED"
        },
        ipAddress: req.ip || null,
        connection: conn
      });
      if (getSimulatedMidTransactionFailure() === "finance_payment") {
        throw new Error("SIMULATED_DB_DISCONNECT");
      }
      await conn.commit();
      res.status(201).json({
        ok: true,
        transactionId: result.insertId,
        message: "\u067E\u0631\u062F\u0627\u062E\u062A / \u0633\u0627\u0628\u0642\u0647 \u0645\u0627\u0644\u06CC \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u0628\u0647 \u0645\u062C\u0645\u0648\u0639 \u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627\u06CC \u0642\u0637\u0639\u06CC \u0627\u0636\u0627\u0641\u0647 \u0634\u062F."
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      const errObj = err;
      if (errObj?.code === "ER_DUP_ENTRY") {
        res.status(409).json({
          ok: false,
          code: "DUPLICATE_REQUEST",
          message: "\u0627\u06CC\u0646 \u067E\u0631\u062F\u0627\u062E\u062A \u0642\u0628\u0644\u0627\u064B \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A."
        });
        return;
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.post(
  "/finance/:id/review",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const txId = Number(req.params.id);
      const decision = String(req.body?.decision || "");
      const managerNote = req.body?.manager_note ? String(req.body.manager_note).trim().slice(0, 500) : null;
      if (!txId || !["APPROVED", "REJECTED"].includes(decision)) {
        res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u062A\u0631\u0627\u06A9\u0646\u0634 \u06CC\u0627 \u0648\u0636\u0639\u06CC\u062A \u062A\u0635\u0645\u06CC\u0645 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A." });
        return;
      }
      const managerId = req.user.id;
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT * FROM financial_transactions WHERE id = ? FOR UPDATE`,
        [txId]
      );
      if (rows.length === 0) {
        await conn.rollback();
        res.status(404).json({ ok: false, message: "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0627\u0644\u06CC \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
        return;
      }
      const tx = mapRowToFinancialTx(rows[0]);
      if (tx.status !== "PENDING") {
        await conn.rollback();
        res.status(409).json({
          ok: false,
          code: "ALREADY_REVIEWED",
          message: `\u0627\u06CC\u0646 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0642\u0628\u0644\u0627\u064B \u0628\u0631\u0631\u0633\u06CC \u0634\u062F\u0647 \u0648 \u062F\u0631 \u0648\u0636\u0639\u06CC\u062A \xAB${tx.status === "APPROVED" ? "\u062A\u0623\u06CC\u06CC\u062F\u0634\u062F\u0647" : "\u0631\u062F\u0634\u062F\u0647"}\xBB \u0642\u0631\u0627\u0631 \u062F\u0627\u0631\u062F.`
        });
        return;
      }
      await conn.execute(
        `UPDATE financial_transactions
         SET status = ?, is_seen_by_manager = 1, reviewed_by_user_id = ?, reviewed_at = NOW(), manager_note = ?
         WHERE id = ? AND status = 'PENDING'`,
        [decision, managerId, managerNote, txId]
      );
      await recordAuditLog({
        actorUserId: managerId,
        actionType: "FINANCE_REVIEW",
        targetEntity: "financial_transactions",
        targetId: txId,
        beforeState: { status: tx.status, amount_toman: tx.amount_toman },
        afterState: { status: decision, manager_note: managerNote },
        ipAddress: req.ip || null,
        connection: conn
      });
      if (getSimulatedMidTransactionFailure() === "finance_payment") {
        throw new Error("SIMULATED_DB_DISCONNECT");
      }
      await conn.commit();
      res.json({
        ok: true,
        message: decision === "APPROVED" ? "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0627\u0644\u06CC / \u0647\u0632\u06CC\u0646\u0647 \u062A\u0646\u062E\u0648\u0627\u0647 \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F \u0648 \u062F\u0631 \u062D\u0633\u0627\u0628 \u067E\u0631\u0633\u0646\u0644 \u0645\u0646\u0638\u0648\u0631 \u06AF\u0631\u062F\u06CC\u062F." : "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0645\u0627\u0644\u06CC \u0631\u062F \u0634\u062F."
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.put(
  "/finance/:id",
  requireAuth,
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const txId = Number(req.params.id);
      if (!txId) {
        res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u062A\u0631\u0627\u06A9\u0646\u0634 \u0645\u0627\u0644\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      const rawAmount = toEnglishDigits(String(req.body?.amount_toman || "")).replace(/,/g, "").trim();
      const amountToman = Number(rawAmount);
      const txType = String(req.body?.tx_type || "");
      const description = String(req.body?.description || "").trim();
      const shamsiDateInput = req.body?.shamsi_date ? String(req.body.shamsi_date).trim() : "";
      const managerNote = req.body?.manager_note !== void 0 && req.body?.manager_note !== null ? String(req.body.manager_note).trim().slice(0, 500) : null;
      const statusInput = req.body?.status ? String(req.body.status).trim() : "";
      if (!Number.isInteger(amountToman) || amountToman <= 0) {
        res.status(400).json({ ok: false, message: "\u0645\u0628\u0644\u063A \u0628\u0627\u06CC\u062F \u06CC\u06A9 \u0639\u062F\u062F \u0635\u062D\u06CC\u062D \u0645\u062B\u0628\u062A \u0628\u0647 \u062A\u0648\u0645\u0627\u0646 \u0628\u0627\u0634\u062F." });
        return;
      }
      const validTypes = ["ADVANCE", "ON_ACCOUNT", "SALARY", "PETTY_CASH", "OTHER"];
      if (!validTypes.includes(txType)) {
        res.status(400).json({ ok: false, message: "\u0646\u0648\u0639 \u062A\u0631\u0627\u06A9\u0646\u0634 \u0645\u0627\u0644\u06CC \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      if (!description || description.length < 2) {
        res.status(400).json({ ok: false, message: "\u062B\u0628\u062A \u0634\u0631\u062D \u062A\u0631\u0627\u06A9\u0646\u0634 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
        return;
      }
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT * FROM financial_transactions WHERE id = ? FOR UPDATE`,
        [txId]
      );
      if (rows.length === 0) {
        await conn.rollback();
        res.status(404).json({ ok: false, message: "\u0645\u0648\u0631\u062F \u0645\u0627\u0644\u06CC \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
        return;
      }
      const existing = mapRowToFinancialTx(rows[0]);
      const isManager = req.user.role === "manager";
      if (!isManager && (existing.user_id !== req.user.id || existing.created_by_user_id !== req.user.id)) {
        await conn.rollback();
        res.status(403).json({
          ok: false,
          code: "FORBIDDEN",
          message: "\u0634\u0645\u0627 \u0645\u062C\u0648\u0632 \u0648\u06CC\u0631\u0627\u06CC\u0634 \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0645\u0627\u0644\u06CC \u06A9\u0627\u0631\u0628\u0631 \u062F\u06CC\u06AF\u0631 \u0631\u0627 \u0646\u062F\u0627\u0631\u06CC\u062F."
        });
        return;
      }
      if (!isManager && existing.status !== "PENDING") {
        await conn.rollback();
        res.status(403).json({
          ok: false,
          message: "\u067E\u0633 \u0627\u0632 \u0628\u0631\u0631\u0633\u06CC \u0645\u062F\u06CC\u0631\u06CC\u062A\u060C \u0641\u0642\u0637 \u0645\u062F\u06CC\u0631 \u0627\u0645\u06A9\u0627\u0646 \u0648\u06CC\u0631\u0627\u06CC\u0634 \u0648 \u0627\u0635\u0644\u0627\u062D \u0645\u0648\u0627\u0631\u062F \u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0634\u062F\u0647 \u0631\u0627 \u062F\u0627\u0631\u062F."
        });
        return;
      }
      const shamsiDate = shamsiDateInput ? normalizeShamsiDate(shamsiDateInput) : existing.shamsi_date;
      const txDate = shamsiToGregorian(shamsiDate);
      const nextStatus = isManager && ["PENDING", "APPROVED", "REJECTED"].includes(statusInput) ? statusInput : existing.status;
      const nextManagerNote = isManager ? managerNote : existing.manager_note;
      await conn.execute(
        `UPDATE financial_transactions
         SET amount_toman = ?,
             tx_type = ?,
             tx_date = ?,
             shamsi_date = ?,
             description = ?,
             manager_note = ?,
             status = ?,
             reviewed_by_user_id = CASE WHEN ? = 1 THEN ? ELSE reviewed_by_user_id END,
             reviewed_at = CASE WHEN ? = 1 THEN NOW() ELSE reviewed_at END
         WHERE id = ?`,
        [
          amountToman,
          txType,
          txDate,
          shamsiDate,
          description,
          nextManagerNote,
          nextStatus,
          isManager ? 1 : 0,
          req.user.id,
          isManager ? 1 : 0,
          txId
        ]
      );
      await recordAuditLog({
        actorUserId: req.user.id,
        actionType: "FINANCE_UPDATE",
        targetEntity: "financial_transactions",
        targetId: txId,
        beforeState: {
          amount_toman: existing.amount_toman,
          tx_type: existing.tx_type,
          shamsi_date: existing.shamsi_date,
          status: existing.status
        },
        afterState: {
          amount_toman: amountToman,
          tx_type: txType,
          shamsi_date: shamsiDate,
          status: nextStatus
        },
        ipAddress: req.ip || null,
        connection: conn
      });
      await conn.commit();
      res.json({
        ok: true,
        message: "\u0627\u0637\u0644\u0627\u0639\u0627\u062A \u067E\u0631\u062F\u0627\u062E\u062A / \u062A\u0631\u0627\u06A9\u0646\u0634 \u0645\u0627\u0644\u06CC \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0635\u0644\u0627\u062D \u0648 \u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F."
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.delete(
  "/finance/:id",
  requireAuth,
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const txId = Number(req.params.id);
      if (!txId) {
        res.status(400).json({ ok: false, message: "\u0634\u0646\u0627\u0633\u0647 \u062A\u0631\u0627\u06A9\u0646\u0634 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        "SELECT * FROM financial_transactions WHERE id = ? FOR UPDATE",
        [txId]
      );
      if (rows.length === 0) {
        await conn.rollback();
        res.status(404).json({ ok: false, message: "\u0645\u0648\u0631\u062F \u0645\u0627\u0644\u06CC \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
        return;
      }
      const existing = mapRowToFinancialTx(rows[0]);
      if (req.user.role !== "manager" && (existing.user_id !== req.user.id || existing.created_by_user_id !== req.user.id)) {
        await conn.rollback();
        res.status(403).json({
          ok: false,
          code: "FORBIDDEN",
          message: "\u0634\u0645\u0627 \u0645\u062C\u0648\u0632 \u062D\u0630\u0641 \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0645\u0627\u0644\u06CC \u06A9\u0627\u0631\u0628\u0631 \u062F\u06CC\u06AF\u0631 \u0631\u0627 \u0646\u062F\u0627\u0631\u06CC\u062F."
        });
        return;
      }
      if (req.user.role !== "manager" && existing.status !== "PENDING") {
        await conn.rollback();
        res.status(403).json({
          ok: false,
          message: "\u0641\u0642\u0637 \u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0645\u06A9\u0627\u0646 \u062D\u0630\u0641 \u0645\u0648\u0627\u0631\u062F \u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0634\u062F\u0647 \u06CC\u0627 \u0628\u0631\u0631\u0633\u06CC\u200C\u0634\u062F\u0647 \u0631\u0627 \u062F\u0627\u0631\u062F."
        });
        return;
      }
      await conn.execute("DELETE FROM financial_transactions WHERE id = ?", [txId]);
      await recordAuditLog({
        actorUserId: req.user.id,
        actionType: "FINANCE_DELETE",
        targetEntity: "financial_transactions",
        targetId: txId,
        beforeState: {
          amount_toman: existing.amount_toman,
          tx_type: existing.tx_type,
          shamsi_date: existing.shamsi_date,
          status: existing.status,
          description: existing.description
        },
        ipAddress: req.ip || null,
        connection: conn
      });
      await conn.commit();
      res.json({
        ok: true,
        message: "\u0645\u0648\u0631\u062F \u0645\u0627\u0644\u06CC \u062D\u0630\u0641 \u0634\u062F \u0648 \u0645\u0627\u0646\u062F\u0647 \u062D\u0633\u0627\u0628 \u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u06AF\u0631\u062F\u06CC\u062F."
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.get("/correspondences", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const search = req.query.search ? String(req.query.search).trim() : "";
    const fromShamsi = req.query.fromShamsi ? normalizeShamsiDate(String(req.query.fromShamsi)) : "";
    const toShamsi = req.query.toShamsi ? normalizeShamsiDate(String(req.query.toShamsi)) : "";
    const senderRole = req.query.senderRole ? String(req.query.senderRole).trim() : "";
    let sql = `
      SELECT c.*,
             s.full_name AS sender_name,
             s.role AS sender_role,
             s.avatar_url AS sender_avatar_url,
             p.message_text AS parent_preview
      FROM work_correspondences c
      INNER JOIN users s ON s.id = c.sender_user_id
      LEFT JOIN work_correspondences p ON p.id = c.parent_id
      WHERE 1=1
    `;
    const params = [];
    if (req.user.role !== "manager") {
      sql += ` AND (c.sender_user_id = ? OR c.receiver_user_id = ?)`;
      params.push(req.user.id, req.user.id);
    }
    if (fromShamsi) {
      sql += ` AND c.shamsi_date >= ?`;
      params.push(fromShamsi);
    }
    if (toShamsi) {
      sql += ` AND c.shamsi_date <= ?`;
      params.push(toShamsi);
    }
    if (senderRole && ["manager", "worker"].includes(senderRole)) {
      sql += ` AND s.role = ?`;
      params.push(senderRole);
    }
    if (search) {
      sql += ` AND (c.subject LIKE ? OR c.message_text LIKE ? OR c.attachments_json LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ` ORDER BY c.id DESC LIMIT 300`;
    const [rows] = await pool2.execute(sql, params);
    const items = rows.map((r) => {
      let attachments = [];
      if (r.attachments_json) {
        try {
          attachments = typeof r.attachments_json === "string" ? JSON.parse(r.attachments_json) : r.attachments_json;
        } catch {
          attachments = [];
        }
      }
      return {
        id: Number(r.id),
        sender_user_id: Number(r.sender_user_id),
        sender_role: r.sender_role,
        sender_name: String(r.sender_name),
        sender_avatar_url: r.sender_avatar_url ? String(r.sender_avatar_url) : null,
        receiver_user_id: Number(r.receiver_user_id),
        parent_id: r.parent_id ? Number(r.parent_id) : null,
        parent_preview: r.parent_preview ? String(r.parent_preview).slice(0, 100) : null,
        subject: r.subject ? String(r.subject) : null,
        message_text: String(r.message_text),
        audio_url: r.audio_url ? String(r.audio_url) : null,
        audio_duration_seconds: r.audio_duration_seconds !== null && r.audio_duration_seconds !== void 0 ? Number(r.audio_duration_seconds) : null,
        attachments,
        delivery_channel: r.delivery_channel || "IN_APP",
        sms_sent: Boolean(r.sms_sent),
        sms_status_text: r.sms_status_text ? String(r.sms_status_text) : null,
        shamsi_date: String(r.shamsi_date),
        recorded_time: String(r.recorded_time),
        is_read: Boolean(r.is_read),
        read_at: r.read_at ? new Date(r.read_at).toISOString() : null,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
      };
    });
    const [unreadRows] = await pool2.execute(
      "SELECT COUNT(*) AS cnt FROM work_correspondences WHERE receiver_user_id = ? AND is_read = 0",
      [req.user.id]
    );
    res.json({
      ok: true,
      correspondences: items,
      unreadCount: Number(unreadRows[0]?.cnt || 0)
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/correspondences", requireAuth, async (req, res) => {
  try {
    const subject = req.body?.subject ? String(req.body.subject).trim().slice(0, 200) : null;
    const messageText = String(req.body?.message_text || "").trim();
    const parentId = req.body?.parent_id ? Number(req.body.parent_id) : null;
    const rawChannel = String(req.body?.delivery_channel || "IN_APP");
    const deliveryChannel = req.user.role === "manager" && ["IN_APP", "SMS", "BOTH"].includes(rawChannel) ? rawChannel : "IN_APP";
    const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    const audioBase64 = req.body?.audio_base64 ? String(req.body.audio_base64) : null;
    const audioMimeType = req.body?.audio_mime_type ? String(req.body.audio_mime_type) : "audio/webm";
    const audioDurationSeconds = req.body?.audio_duration_seconds ? Math.max(1, Math.round(Number(req.body.audio_duration_seconds))) : null;
    if (!messageText && rawFiles.length === 0 && !audioBase64) {
      res.status(400).json({
        ok: false,
        message: "\u0645\u062A\u0646 \u067E\u06CC\u0627\u0645\u060C \u067E\u06CC\u0627\u0645 \u0635\u0648\u062A\u06CC \u06CC\u0627 \u062D\u062F\u0627\u0642\u0644 \u06CC\u06A9 \u0641\u0627\u06CC\u0644 \u067E\u06CC\u0648\u0633\u062A \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A."
      });
      return;
    }
    let savedAudioUrl = null;
    if (audioBase64) {
      const ext = audioMimeType.includes("mp4") ? ".mp4" : audioMimeType.includes("ogg") ? ".ogg" : ".webm";
      const savedAudio = saveBase64MediaFile("audio", `voice-message${ext}`, audioBase64);
      savedAudioUrl = savedAudio.publicUrl;
    }
    const attachments = [];
    for (const f of rawFiles.slice(0, 6)) {
      if (f && f.file_base64 && f.file_name) {
        const saved = saveBase64MediaFile(
          "attachments",
          String(f.file_name),
          String(f.file_base64)
        );
        attachments.push({
          file_name: String(f.file_name),
          file_url: saved.publicUrl,
          file_size: saved.sizeBytes,
          mime_type: String(f.mime_type || "application/octet-stream")
        });
      }
    }
    const pool2 = getPool();
    const settings = await getSystemSettingsFromDb();
    const nowInfo = getNowInTimezone(settings.timezone);
    const targetRole = req.user.role === "manager" ? "worker" : "manager";
    const [targetRows] = await pool2.execute(
      "SELECT id, phone_number FROM users WHERE role = ? LIMIT 1",
      [targetRole]
    );
    if (targetRows.length === 0) {
      res.status(404).json({ ok: false, message: "\u06AF\u06CC\u0631\u0646\u062F\u0647 \u067E\u06CC\u0627\u0645 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
      return;
    }
    const receiverId = Number(targetRows[0].id);
    const workerPhone = settings.worker_phone_number || (targetRows[0].phone_number ? String(targetRows[0].phone_number) : "");
    let smsSent = false;
    let smsStatusText = null;
    const effectiveText = messageText || (savedAudioUrl ? "\u067E\u06CC\u0627\u0645 \u0635\u0648\u062A\u06CC \u062C\u062F\u06CC\u062F" : "\u0627\u0631\u0633\u0627\u0644 \u0641\u0627\u06CC\u0644 \u067E\u06CC\u0648\u0633\u062A");
    if (req.user.role === "manager" && (deliveryChannel === "SMS" || deliveryChannel === "BOTH")) {
      const smsBody = `\u067E\u06CC\u0627\u0645 \u0645\u062F\u06CC\u0631\u06CC\u062A (\u0645\u062C\u06CC\u062F \u0646\u0648\u0631\u0627\u06CC\u06CC)
${subject ? `${subject}: ` : ""}${effectiveText}`;
      const smsRes = await sendMelipayamakSms(settings, workerPhone, smsBody);
      smsSent = smsRes.sent;
      smsStatusText = smsRes.statusMessage;
    }
    const [ins] = await pool2.execute(
      `INSERT INTO work_correspondences
        (sender_user_id, receiver_user_id, parent_id, subject, message_text, audio_url, audio_duration_seconds, attachments_json, delivery_channel, sms_sent, sms_status_text, shamsi_date, work_date, recorded_time, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        req.user.id,
        receiverId,
        parentId,
        subject,
        effectiveText,
        savedAudioUrl,
        audioDurationSeconds,
        JSON.stringify(attachments),
        deliveryChannel,
        smsSent ? 1 : 0,
        smsStatusText,
        nowInfo.shamsiDate,
        nowInfo.workDate,
        nowInfo.timeHHMMSS
      ]
    );
    let feedbackMsg = "\u067E\u06CC\u0627\u0645 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u0648 \u062B\u0628\u062A \u0634\u062F.";
    if (deliveryChannel === "SMS" || deliveryChannel === "BOTH") {
      feedbackMsg = smsSent ? "\u067E\u06CC\u0627\u0645 \u062B\u0628\u062A \u0634\u062F \u0648 \u067E\u06CC\u0627\u0645\u06A9 \u0646\u06CC\u0632 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u06AF\u0631\u062F\u06CC\u062F." : `\u067E\u06CC\u0627\u0645 \u062F\u0631 \u0628\u0631\u0646\u0627\u0645\u0647 \u062B\u0628\u062A \u0634\u062F \u0627\u0645\u0627 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645\u06A9 \u0627\u0646\u062C\u0627\u0645 \u0646\u0634\u062F: ${smsStatusText}`;
    }
    res.status(201).json({
      ok: true,
      id: ins.insertId,
      smsSent,
      smsStatusText,
      message: feedbackMsg
    });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.post("/correspondences/mark-read", requireAuth, async (req, res) => {
  try {
    const pool2 = getPool();
    const messageId = req.body?.id ? Number(req.body.id) : null;
    if (messageId) {
      await pool2.execute(
        "UPDATE work_correspondences SET is_read = 1, read_at = NOW() WHERE id = ? AND receiver_user_id = ? AND is_read = 0",
        [messageId, req.user.id]
      );
    } else {
      await pool2.execute(
        "UPDATE work_correspondences SET is_read = 1, read_at = NOW() WHERE receiver_user_id = ? AND is_read = 0",
        [req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.get(
  "/manager/dashboard",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const pool2 = getPool();
      const workerInfo = await getWorkerInfo(pool2);
      const workerId = workerInfo.id;
      const currentSettings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(currentSettings.timezone);
      const [allLogRows] = await pool2.execute(
        `SELECT * FROM attendance_logs
         WHERE user_id = ? AND is_deleted = 0
         ORDER BY work_date DESC, recorded_time ASC, id ASC`,
        [workerId]
      );
      const allLogs = allLogRows.map(mapRowToAttendanceLog);
      const byDate = /* @__PURE__ */ new Map();
      for (const log of allLogs) {
        const list = byDate.get(log.work_date) || [];
        list.push(log);
        byDate.set(log.work_date, list);
      }
      const todayLogs = allLogs.filter((l) => l.shamsi_date === nowInfo.shamsiDate || l.work_date === nowInfo.workDate).sort((a, b) => a.recorded_time.localeCompare(b.recorded_time) || a.id - b.id);
      const liveState = evaluateWorkerLiveState(todayLogs, currentSettings);
      liveState.worker_profile = {
        full_name: workerInfo.full_name,
        avatar_url: workerInfo.avatar_url,
        collaboration_start_shamsi: currentSettings.collaboration_start_shamsi || workerInfo.collaboration_start_shamsi || "1405/06/15",
        phone_number: currentSettings.worker_phone_number || workerInfo.phone_number
      };
      await attachForgottenCheckoutWarning(pool2, workerId, liveState, currentSettings, nowInfo);
      let totalConfirmedNetWorkMinutes = 0;
      let totalConfirmedOvertimeMinutes = 0;
      let totalRecordedWorkDays = 0;
      let incompleteDaysCount = 0;
      let hourlyEarnedRegularWorkToman = 0;
      let totalOvertimePayTomanAccum = 0;
      let totalLateDeductionTomanAccum = 0;
      const confirmedAttendanceShamsiDates = /* @__PURE__ */ new Set();
      const activeMonthlyCycles = /* @__PURE__ */ new Set();
      const dailySummaries = [];
      const pendingLateReviews = [];
      const reviewedLateSummaries = [];
      for (const [workDate, dayLogs] of byDate.entries()) {
        const shamsiDate = normalizeShamsiDate(dayLogs[0]?.shamsi_date || gregorianToShamsi(workDate));
        const effectiveSettings = await getSystemSettingsFromDb(shamsiDate);
        const summary = calculateDailyAttendance(workDate, shamsiDate, dayLogs, effectiveSettings, {
          isToday: workDate === nowInfo.workDate,
          currentTimeHHMM: nowInfo.timeHHMM
        });
        dailySummaries.push(summary);
        if ((summary.raw_late_minutes || 0) > 0 || summary.late_status && summary.late_status !== "NONE") {
          if (!summary.late_status || summary.late_status === "PENDING") {
            pendingLateReviews.push(summary);
          } else if (reviewedLateSummaries.length < 20) {
            reviewedLateSummaries.push(summary);
          }
        }
        if (summary.late_deduction_toman && summary.late_deduction_toman > 0) {
          totalLateDeductionTomanAccum += summary.late_deduction_toman;
        }
        if (summary.is_incomplete) {
          incompleteDaysCount += 1;
        } else if (summary.logs.length > 0) {
          confirmedAttendanceShamsiDates.add(shamsiDate);
          if (summary.net_work_minutes > 0 || summary.overtime_minutes > 0 || summary.late_status === "ABSENCE") {
            activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(shamsiDate, 15));
          }
          if (summary.late_status !== "ABSENCE") {
            totalRecordedWorkDays += 1;
          }
          totalConfirmedNetWorkMinutes += summary.net_work_minutes;
          totalConfirmedOvertimeMinutes += summary.overtime_minutes;
          const dayRegularMinutes = Math.max(0, summary.net_work_minutes - summary.overtime_minutes);
          const daySalaryCalc = calculateSalaryAndOvertimeRates(
            effectiveSettings,
            summary.overtime_minutes
          );
          hourlyEarnedRegularWorkToman += Math.round(
            dayRegularMinutes / 60 * daySalaryCalc.effectiveHourlyRateToman
          );
          totalOvertimePayTomanAccum += daySalaryCalc.totalOvertimePayToman;
        }
      }
      const [histTotals] = await pool2.execute(
        `SELECT
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_hist_count,
           COUNT(CASE WHEN is_seen_by_manager = 0 THEN 1 END) AS unseen_hist_count
         FROM historical_work_records
         WHERE user_id = ?`,
        [workerId]
      );
      const [histAllRows] = await pool2.execute(
        `SELECT h.*, u.role AS creator_role
         FROM historical_work_records h
         LEFT JOIN users u ON u.id = h.created_by_user_id
         WHERE h.user_id = ?
         ORDER BY h.work_date DESC, h.id DESC`,
        [workerId]
      );
      const historicalRecords = histAllRows.map(mapRowToHistoricalWork);
      for (const rec of historicalRecords) {
        if (rec.status !== "APPROVED") continue;
        if (rec.parsed_rows && rec.parsed_rows.length > 0) {
          for (const row of rec.parsed_rows) {
            if (!row.shamsi_date || !isValidShamsiDate(row.shamsi_date)) continue;
            const normShamsi = normalizeShamsiDate(row.shamsi_date);
            if (confirmedAttendanceShamsiDates.has(normShamsi)) continue;
            confirmedAttendanceShamsiDates.add(normShamsi);
            const rowNetMins = Number(row.net_work_minutes || 0);
            const rowOtMins = Number(row.overtime_minutes || 0);
            if (rowNetMins > 0 || rowOtMins > 0) {
              activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(normShamsi, 15));
            }
            totalRecordedWorkDays += 1;
            totalConfirmedNetWorkMinutes += rowNetMins;
            totalConfirmedOvertimeMinutes += rowOtMins;
            const effSet = await getSystemSettingsFromDb(normShamsi);
            const rowCalc = calculateSalaryAndOvertimeRates(effSet, rowOtMins);
            hourlyEarnedRegularWorkToman += Math.round(
              rowNetMins / 60 * rowCalc.effectiveHourlyRateToman
            );
            totalOvertimePayTomanAccum += rowCalc.totalOvertimePayToman;
          }
        } else {
          const normShamsi = isValidShamsiDate(rec.shamsi_date) ? normalizeShamsiDate(rec.shamsi_date) : rec.shamsi_date;
          if (rec.work_days_count === 1 && confirmedAttendanceShamsiDates.has(normShamsi)) {
            continue;
          }
          if (rec.work_days_count === 1 && normShamsi) {
            confirmedAttendanceShamsiDates.add(normShamsi);
          }
          if ((rec.net_work_minutes > 0 || rec.overtime_minutes > 0) && normShamsi && isValidShamsiDate(normShamsi)) {
            activeMonthlyCycles.add(getMonthlyCycleKeyForShamsiDate(normShamsi, 15));
          }
          totalRecordedWorkDays += rec.work_days_count;
          totalConfirmedNetWorkMinutes += rec.net_work_minutes;
          totalConfirmedOvertimeMinutes += rec.overtime_minutes;
          const effSet = await getSystemSettingsFromDb(normShamsi);
          const recCalc = calculateSalaryAndOvertimeRates(effSet, rec.overtime_minutes);
          hourlyEarnedRegularWorkToman += Math.round(
            rec.net_work_minutes / 60 * recCalc.effectiveHourlyRateToman
          );
          totalOvertimePayTomanAccum += recCalc.totalOvertimePayToman;
        }
      }
      const hasMonthlyFixedSalary = currentSettings.base_salary_toman !== null && currentSettings.base_salary_toman !== void 0 && Number(currentSettings.base_salary_toman) > 0 && (currentSettings.hourly_rate_toman === null || currentSettings.hourly_rate_toman === void 0 || Number(currentSettings.hourly_rate_toman) <= 0);
      const earnedRegularWorkToman = hasMonthlyFixedSalary ? activeMonthlyCycles.size * Math.round(Number(currentSettings.base_salary_toman)) : hourlyEarnedRegularWorkToman;
      const totalSalaryPlusOvertimeToman = Math.max(
        0,
        earnedRegularWorkToman + totalOvertimePayTomanAccum - totalLateDeductionTomanAccum
      );
      const [finRows] = await pool2.execute(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount_toman ELSE 0 END), 0) AS approved_total,
           COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_toman ELSE 0 END), 0) AS pending_total,
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_count,
           COUNT(CASE WHEN is_seen_by_manager = 0 OR status = 'PENDING' THEN 1 END) AS unseen_or_pending_fin
         FROM financial_transactions
         WHERE user_id = ?`,
        [workerId]
      );
      const [repUnseenRows] = await pool2.execute(
        `SELECT COUNT(*) AS unseen_reports FROM daily_work_reports WHERE user_id = ? AND is_seen_by_manager = 0`,
        [workerId]
      );
      const [corrUnreadRows] = await pool2.execute(
        `SELECT COUNT(*) AS unread_corr FROM work_correspondences WHERE receiver_user_id = ? AND is_read = 0`,
        [req.user.id]
      );
      const [leavePendingRows] = await pool2.execute(
        `SELECT
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pending_leaves,
           COUNT(CASE WHEN is_seen_by_manager = 0 OR status = 'PENDING' THEN 1 END) AS unseen_or_pending_leaves
         FROM leave_requests
         WHERE user_id = ?`,
        [workerId]
      );
      const salaryCalc = calculateSalaryAndOvertimeRates(
        currentSettings,
        totalConfirmedOvertimeMinutes
      );
      const deductionRates = calculateLateAndAbsenceRates(currentSettings);
      const mergedDailySummaries = mergeApprovedHistoricalIntoDailySummaries(
        dailySummaries,
        historicalRecords
      );
      const confirmedChronological = [...mergedDailySummaries].filter((d) => d.logs.length > 0 || d.net_work_minutes > 0 || d.overtime_minutes > 0).sort((a, b) => a.work_date.localeCompare(b.work_date));
      const weeklyChartData = confirmedChronological.slice(-7).map((d) => ({
        shamsiDate: d.shamsi_date,
        dayName: d.day_name,
        netHours: Number((d.net_work_minutes / 60).toFixed(2)),
        overtimeHours: Number((d.overtime_minutes / 60).toFixed(2)),
        isIncomplete: d.is_incomplete,
        statusLabel: d.status_label
      }));
      const monthlyChartData = confirmedChronological.slice(-30).map((d) => ({
        shamsiDate: d.shamsi_date,
        dayName: d.day_name,
        netHours: Number((d.net_work_minutes / 60).toFixed(2)),
        overtimeHours: Number((d.overtime_minutes / 60).toFixed(2)),
        isIncomplete: d.is_incomplete,
        statusLabel: d.status_label
      }));
      res.json({
        ok: true,
        serverTime: nowInfo,
        liveState,
        kpis: {
          approvedPaymentsToman: Number(finRows[0]?.approved_total || 0),
          pendingPaymentsToman: Number(finRows[0]?.pending_total || 0),
          pendingPaymentsCount: Number(finRows[0]?.pending_count || 0),
          totalNetWorkMinutes: totalConfirmedNetWorkMinutes,
          totalOvertimeMinutes: totalConfirmedOvertimeMinutes,
          totalWorkDays: totalRecordedWorkDays,
          incompleteDaysCount,
          baseSalaryToman: salaryCalc.baseSalaryToman,
          effectiveHourlyRateToman: salaryCalc.effectiveHourlyRateToman,
          effectiveOvertimeHourlyRateToman: salaryCalc.effectiveOvertimeHourlyRateToman,
          earnedRegularWorkToman,
          totalOvertimePayToman: totalOvertimePayTomanAccum,
          totalLateDeductionToman: totalLateDeductionTomanAccum,
          totalSalaryPlusOvertimeToman,
          deductionRates
        },
        pendingLateReviews,
        reviewedLateSummaries,
        unseenAlerts: {
          financeAlert: Number(finRows[0]?.unseen_or_pending_fin || 0) > 0,
          pendingFinanceCount: Number(finRows[0]?.pending_count || 0),
          reportsAlert: Number(repUnseenRows[0]?.unseen_reports || 0) > 0,
          unseenReportsCount: Number(repUnseenRows[0]?.unseen_reports || 0),
          historicalAlert: Number(histTotals[0]?.pending_hist_count || 0) > 0 || Number(histTotals[0]?.unseen_hist_count || 0) > 0 || Number(leavePendingRows[0]?.unseen_or_pending_leaves || 0) > 0 || pendingLateReviews.length > 0,
          pendingHistoricalCount: Number(histTotals[0]?.pending_hist_count || 0) + Number(leavePendingRows[0]?.pending_leaves || 0) + pendingLateReviews.length,
          pendingLateCount: pendingLateReviews.length,
          correspondenceAlert: Number(corrUnreadRows[0]?.unread_corr || 0) > 0,
          unreadCorrespondenceCount: Number(corrUnreadRows[0]?.unread_corr || 0)
        },
        charts: {
          weekly: weeklyChartData,
          monthly: monthlyChartData
        },
        recentSummaries: mergedDailySummaries.slice(0, 14),
        settings: sanitizeSettingsForRole(currentSettings, "manager")
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get(
  "/manager/backup/excel",
  requireAuth,
  requireRole("manager"),
  async (_req, res) => {
    try {
      const pool2 = getPool();
      const workerId = await getWorkerUserId(pool2);
      const [attRows] = await pool2.execute(
        "SELECT shamsi_date, event_type, recorded_time, note, is_manual_override FROM attendance_logs WHERE user_id = ? AND is_deleted = 0 ORDER BY work_date DESC, recorded_time ASC",
        [workerId]
      );
      const [histRows] = await pool2.execute(
        "SELECT shamsi_date, title, work_days_count, net_work_minutes, overtime_minutes, status, note FROM historical_work_records WHERE user_id = ? ORDER BY work_date DESC",
        [workerId]
      );
      const [finRows] = await pool2.execute(
        "SELECT shamsi_date, tx_type, amount_toman, status, description, manager_note FROM financial_transactions WHERE user_id = ? ORDER BY tx_date DESC",
        [workerId]
      );
      const [leaveRows] = await pool2.execute(
        "SELECT shamsi_date, leave_type, start_time, end_time, duration_minutes, status, reason, manager_note FROM leave_requests WHERE user_id = ? ORDER BY work_date DESC",
        [workerId]
      );
      const [repRows] = await pool2.execute(
        "SELECT shamsi_date, recorded_time, duration_minutes, activity_description FROM daily_work_reports WHERE user_id = ? ORDER BY report_date DESC",
        [workerId]
      );
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          attRows.map((r) => ({
            "\u062A\u0627\u0631\u06CC\u062E": r.shamsi_date,
            "\u0646\u0648\u0639 \u062A\u0631\u062F\u062F": r.event_type === "WORK_START" ? "\u0634\u0631\u0648\u0639 \u06A9\u0627\u0631" : r.event_type === "WORK_END" ? "\u067E\u0627\u06CC\u0627\u0646 \u06A9\u0627\u0631" : r.event_type === "MISSION_START" ? "\u0634\u0631\u0648\u0639 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A" : "\u067E\u0627\u06CC\u0627\u0646 \u0645\u0623\u0645\u0648\u0631\u06CC\u062A",
            "\u0633\u0627\u0639\u062A": r.recorded_time,
            "\u062A\u0648\u0636\u06CC\u062D\u0627\u062A": r.note || "",
            "\u062B\u0628\u062A \u062F\u0633\u062A\u06CC \u0645\u062F\u06CC\u0631": r.is_manual_override ? "\u0628\u0644\u0647" : "\u062E\u06CC\u0631"
          }))
        ),
        "\u062A\u0631\u062F\u062F\u0647\u0627"
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          histRows.map((r) => ({
            "\u062A\u0627\u0631\u06CC\u062E": r.shamsi_date,
            "\u0639\u0646\u0648\u0627\u0646": r.title,
            "\u062A\u0639\u062F\u0627\u062F \u0631\u0648\u0632": r.work_days_count,
            "\u06A9\u0627\u0631\u06A9\u0631\u062F \u062E\u0627\u0644\u0635": formatDurationPersian(Number(r.net_work_minutes || 0)),
            "\u0627\u0636\u0627\u0641\u0647\u200C\u06A9\u0627\u0631\u06CC": formatDurationPersian(Number(r.overtime_minutes || 0)),
            "\u0648\u0636\u0639\u06CC\u062A": r.status === "APPROVED" ? "\u062A\u0623\u06CC\u06CC\u062F\u0634\u062F\u0647" : r.status === "PENDING" ? "\u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631" : "\u0631\u062F\u0634\u062F\u0647",
            "\u062A\u0648\u0636\u06CC\u062D\u0627\u062A": r.note || ""
          }))
        ),
        "\u0633\u0648\u0627\u0628\u0642 \u0642\u0628\u0644\u06CC"
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          finRows.map((r) => ({
            "\u062A\u0627\u0631\u06CC\u062E": r.shamsi_date,
            "\u0646\u0648\u0639 \u062A\u0631\u0627\u06A9\u0646\u0634": r.tx_type === "ADVANCE" ? "\u0645\u0633\u0627\u0639\u062F\u0647" : r.tx_type === "SALARY" ? "\u062D\u0642\u0648\u0642" : r.tx_type === "ON_ACCOUNT" ? "\u0639\u0644\u06CC\u200C\u0627\u0644\u062D\u0633\u0627\u0628" : r.tx_type === "PETTY_CASH" ? "\u0647\u0632\u06CC\u0646\u0647 \u062A\u0646\u062E\u0648\u0627\u0647 / \u062E\u0631\u06CC\u062F \u06A9\u0627\u0631\u06AF\u0627\u0647\u06CC" : "\u0633\u0627\u06CC\u0631",
            "\u0645\u0628\u0644\u063A (\u062A\u0648\u0645\u0627\u0646)": Number(r.amount_toman),
            "\u0648\u0636\u0639\u06CC\u062A": r.status === "APPROVED" ? "\u062A\u0623\u06CC\u06CC\u062F\u0634\u062F\u0647" : r.status === "PENDING" ? "\u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631" : "\u0631\u062F\u0634\u062F\u0647",
            "\u0634\u0631\u062D": r.description,
            "\u06CC\u0627\u062F\u062F\u0627\u0634\u062A \u0645\u062F\u06CC\u0631\u06CC\u062A": r.manager_note || ""
          }))
        ),
        "\u0627\u0645\u0648\u0631 \u0645\u0627\u0644\u06CC \u0648 \u062A\u0646\u062E\u0648\u0627\u0647"
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          leaveRows.map((r) => ({
            "\u062A\u0627\u0631\u06CC\u062E": r.shamsi_date,
            "\u0646\u0648\u0639 \u0645\u0631\u062E\u0635\u06CC": r.leave_type === "HOURLY" ? "\u0633\u0627\u0639\u062A\u06CC" : "\u0631\u0648\u0632\u0627\u0646\u0647",
            "\u0627\u0632 \u0633\u0627\u0639\u062A": r.start_time || "-",
            "\u062A\u0627 \u0633\u0627\u0639\u062A": r.end_time || "-",
            "\u0645\u062F\u062A": formatDurationPersian(Number(r.duration_minutes || 0)),
            "\u0648\u0636\u0639\u06CC\u062A": r.status === "APPROVED" ? "\u062A\u0623\u06CC\u06CC\u062F\u0634\u062F\u0647" : r.status === "PENDING" ? "\u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631" : "\u0631\u062F\u0634\u062F\u0647",
            "\u0639\u0644\u062A": r.reason
          }))
        ),
        "\u0645\u0631\u062E\u0635\u06CC\u200C\u0647\u0627"
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          repRows.map((r) => ({
            "\u062A\u0627\u0631\u06CC\u062E": r.shamsi_date,
            "\u0633\u0627\u0639\u062A \u062B\u0628\u062A": r.recorded_time,
            "\u0645\u062F\u062A (\u062F\u0642\u06CC\u0642\u0647)": r.duration_minutes || "",
            "\u0634\u0631\u062D \u0641\u0639\u0627\u0644\u06CC\u062A": r.activity_description
          }))
        ),
        "\u06AF\u0632\u0627\u0631\u0634 \u06A9\u0627\u0631\u0647\u0627"
      );
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="mgammon-full-backup.xlsx"'
      );
      res.send(buffer);
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get(
  "/manager/backup/json",
  requireAuth,
  requireRole("manager"),
  async (_req, res) => {
    try {
      const pool2 = getPool();
      const settings = await getSystemSettingsFromDb();
      const [attendance] = await pool2.execute("SELECT * FROM attendance_logs WHERE is_deleted = 0");
      const [historical] = await pool2.execute("SELECT * FROM historical_work_records");
      const [finance] = await pool2.execute("SELECT * FROM financial_transactions");
      const [leaves] = await pool2.execute("SELECT * FROM leave_requests");
      const [reports] = await pool2.execute("SELECT * FROM daily_work_reports");
      const [tasks] = await pool2.execute("SELECT * FROM work_tasks");
      const [correspondences] = await pool2.execute("SELECT * FROM work_correspondences");
      const backupPayload = {
        exported_at: (/* @__PURE__ */ new Date()).toISOString(),
        app: "Mgammon",
        settings: sanitizeSettingsForRole(settings, "manager"),
        attendance,
        historical,
        finance,
        leaves,
        reports,
        tasks,
        correspondences
      };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="mgammon-backup.json"');
      res.send(JSON.stringify(backupPayload, null, 2));
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.post(
  "/manager/backup/create",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const result = await createFullBackup();
      await recordAuditLog({
        actorUserId: req.user.id,
        actionType: "FULL_BACKUP_CREATE",
        targetEntity: "system_backups",
        afterState: {
          backupId: result.manifest.backupId,
          sizeBytes: result.sizeBytes,
          checksum: result.manifest.payloadChecksum,
          mediaFilesCount: result.manifest.mediaFilesCount
        },
        ipAddress: req.ip || null
      });
      res.status(201).json({
        ok: true,
        backupId: result.manifest.backupId,
        sizeBytes: result.sizeBytes,
        manifest: result.manifest,
        message: "\u0646\u0633\u062E\u0647 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u06A9\u0627\u0645\u0644 (\u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0648 \u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u062E\u0635\u0648\u0635\u06CC) \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u06CC\u062C\u0627\u062F \u0648 \u0631\u0627\u0633\u062A\u06CC\u200C\u0622\u0632\u0645\u0627\u06CC\u06CC \u0634\u062F."
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get(
  "/manager/backup/list",
  requireAuth,
  requireRole("manager"),
  async (_req, res) => {
    try {
      const backups = listAvailableBackups().map((b) => ({
        fileName: b.fileName,
        sizeBytes: b.sizeBytes,
        valid: b.valid,
        manifest: b.manifest,
        error: b.error
      }));
      res.json({ ok: true, backups });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.post(
  "/manager/backup/verify",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const fileName = import_path3.default.basename(String(req.body?.fileName || "").trim());
      if (!fileName || !fileName.endsWith(".mgbackup.json")) {
        res.status(400).json({ ok: false, message: "\u0646\u0627\u0645 \u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      const backupDir = process.env.BACKUP_DIR || import_path3.default.resolve(process.cwd(), ".data/backups");
      const fullPath = import_path3.default.join(backupDir, fileName);
      const verification = verifyBackupArchive(fullPath);
      if (!verification.valid) {
        res.status(422).json({
          ok: false,
          valid: false,
          message: verification.reason || "\u0646\u0633\u062E\u0647 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A."
        });
        return;
      }
      res.json({
        ok: true,
        valid: true,
        manifest: verification.manifest,
        message: "\u0635\u062D\u062A \u0633\u0627\u062E\u062A\u0627\u0631 \u0648 \u0627\u0645\u0636\u0627\u06CC \u062F\u06CC\u062C\u06CC\u062A\u0627\u0644 (SHA-256) \u0646\u0633\u062E\u0647 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F."
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get("/settings", requireAuth, async (req, res) => {
  try {
    const settings = await getSystemSettingsFromDb();
    res.json({ ok: true, settings: sanitizeSettingsForRole(settings, req.user.role) });
  } catch (err) {
    handleServerError(res, err);
  }
});
apiRouter.put(
  "/settings/banner",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const bannerBgUrl = req.body?.banner_bg_url ? String(req.body.banner_bg_url).trim() : null;
      if (bannerBgUrl && !bannerBgUrl.startsWith("/") && !bannerBgUrl.startsWith("https://")) {
        res.status(400).json({ ok: false, message: "\u0622\u062F\u0631\u0633 \u062A\u0635\u0648\u06CC\u0631 \u0628\u0646\u0631 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      const pool2 = getPool();
      await pool2.execute("UPDATE system_settings SET banner_bg_url = ?, updated_by_user_id = ?", [
        bannerBgUrl,
        req.user.id
      ]);
      res.json({
        ok: true,
        banner_bg_url: bannerBgUrl,
        message: "\u062A\u0635\u0648\u06CC\u0631 \u0628\u0646\u0631 \u0633\u0627\u0645\u0627\u0646\u0647 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC \u0634\u062F."
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.put(
  "/settings",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    const pool2 = getPool();
    let conn = null;
    try {
      const currentSettings = await getSystemSettingsFromDb();
      const nowInfo = getNowInTimezone(currentSettings.timezone);
      const shiftStart = toEnglishDigits(
        String(req.body?.shift_start_time || currentSettings.shift_start_time)
      ).trim();
      const shiftEnd = toEnglishDigits(
        String(req.body?.shift_end_time || currentSettings.shift_end_time)
      ).trim();
      const overtimeStart = toEnglishDigits(
        String(req.body?.overtime_start_time || currentSettings.overtime_start_time)
      ).trim();
      const thuStart = toEnglishDigits(
        String(req.body?.thursday_shift_start_time || currentSettings.thursday_shift_start_time || "07:00")
      ).trim();
      const thuEnd = toEnglishDigits(
        String(req.body?.thursday_shift_end_time || currentSettings.thursday_shift_end_time || "14:00")
      ).trim();
      const thuOtStart = toEnglishDigits(
        String(
          req.body?.thursday_overtime_start_time || req.body?.thursday_shift_end_time || currentSettings.thursday_overtime_start_time || "14:00"
        )
      ).trim();
      if (!isValidTimeHHMMOrHHMMSS(shiftStart, false) || !isValidTimeHHMMOrHHMMSS(shiftEnd, false) || !isValidTimeHHMMOrHHMMSS(overtimeStart, false) || !isValidTimeHHMMOrHHMMSS(thuStart, false) || !isValidTimeHHMMOrHHMMSS(thuEnd, false) || !isValidTimeHHMMOrHHMMSS(thuOtStart, false)) {
        res.status(400).json({ ok: false, message: "\u0641\u0631\u0645\u062A \u062A\u0645\u0627\u0645 \u0633\u0627\u0639\u0627\u062A \u0634\u06CC\u0641\u062A \u0648 \u067E\u0646\u062C\u0634\u0646\u0628\u0647 \u0628\u0627\u06CC\u062F HH:MM \u0645\u0639\u062A\u0628\u0631 (00:00 \u062A\u0627 23:59) \u0628\u0627\u0634\u062F." });
        return;
      }
      const gracePeriod = Math.max(
        0,
        Math.min(240, Number(req.body?.grace_period_minutes ?? currentSettings.grace_period_minutes))
      );
      const breakDuration = Math.max(
        0,
        Math.min(240, Number(req.body?.break_duration_minutes ?? currentSettings.break_duration_minutes))
      );
      const workingDays = Array.isArray(req.body?.working_days) ? req.body.working_days.map(Number).filter((d) => d >= 0 && d <= 6) : currentSettings.working_days;
      const overtimeBeforeShift = Boolean(req.body?.overtime_before_shift);
      const missionPolicy = req.body?.mission_policy === "SEPARATE_EXTRA" ? "SEPARATE_EXTRA" : "PAID_AS_WORK";
      const fridayHolidayPolicy = ["ALL_OVERTIME", "REGULAR_WORK", "DISABLED"].includes(
        req.body?.friday_holiday_policy
      ) ? req.body.friday_holiday_policy : "ALL_OVERTIME";
      const officialHolidays = Array.isArray(req.body?.official_holidays) ? req.body.official_holidays.map((d) => toEnglishDigits(String(d)).trim()).filter((d) => isValidShamsiDate(d)).map((d) => normalizeShamsiDate(d)) : currentSettings.official_holidays;
      const parseOptionalToman = (val) => {
        if (val === null || val === void 0 || String(val).trim() === "") return null;
        const n = Number(toEnglishDigits(String(val)).replace(/,/g, "").trim());
        return Number.isNaN(n) || n <= 0 ? null : Math.round(n);
      };
      const baseSalaryToman = parseOptionalToman(req.body?.base_salary_toman);
      const hourlyRate = parseOptionalToman(req.body?.hourly_rate_toman);
      const overtimeRate = parseOptionalToman(req.body?.overtime_rate_toman);
      const lateDeductionUnit = req.body?.late_deduction_unit === "HOUR" ? "HOUR" : "MINUTE";
      const lateDeductionRateToman = parseOptionalToman(req.body?.late_deduction_rate_toman);
      const absenceDeductionUnit = req.body?.absence_deduction_unit === "HOUR" ? "HOUR" : "DAY";
      const absenceDeductionRateToman = parseOptionalToman(req.body?.absence_deduction_rate_toman);
      const overtimeCalcMode = req.body?.overtime_calc_mode === "FIXED_RATE" ? "FIXED_RATE" : "PERCENTAGE";
      const overtimePercentage = Math.max(
        1,
        Math.min(500, Number(toEnglishDigits(String(req.body?.overtime_percentage ?? 140))) || 140)
      );
      const collabRaw = String(
        req.body?.collaboration_start_shamsi || currentSettings.collaboration_start_shamsi || "1405/06/15"
      ).trim();
      const collaborationStartShamsi = isValidShamsiDate(collabRaw) ? normalizeShamsiDate(collabRaw) : currentSettings.collaboration_start_shamsi || "1405/06/15";
      const monthlyLeaveQuotaDays = Math.max(
        0,
        Math.min(
          30,
          Number(
            toEnglishDigits(
              String(req.body?.monthly_leave_quota_days ?? currentSettings.monthly_leave_quota_days ?? 2.5)
            )
          ) || 2.5
        )
      );
      const smsEnabled = Boolean(req.body?.sms_enabled);
      const smsOnTaskAndMessage = req.body?.sms_on_task_and_message !== void 0 ? Boolean(req.body.sms_on_task_and_message) : Boolean(currentSettings.sms_on_task_and_message);
      const melipayamakUsername = String(req.body?.melipayamak_username ?? currentSettings.melipayamak_username).trim();
      const rawInputSmsPass = String(req.body?.melipayamak_password ?? "").trim();
      const melipayamakPassword = rawInputSmsPass && rawInputSmsPass !== "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" ? rawInputSmsPass : currentSettings.melipayamak_password;
      const melipayamakFromNumber = toEnglishDigits(
        String(req.body?.melipayamak_from_number ?? currentSettings.melipayamak_from_number)
      ).trim();
      const melipayamakIsFlash = Boolean(req.body?.melipayamak_is_flash);
      const workerPhoneNumber = toEnglishDigits(
        String(req.body?.worker_phone_number ?? currentSettings.worker_phone_number)
      ).trim();
      const applyRetroactively = Boolean(req.body?.apply_retroactively);
      const effectiveFromShamsi = applyRetroactively ? "1400/01/01" : req.body?.effective_from_shamsi && isValidShamsiDate(String(req.body.effective_from_shamsi)) ? normalizeShamsiDate(String(req.body.effective_from_shamsi)) : nowInfo.shamsiDate;
      conn = await pool2.getConnection();
      await conn.beginTransaction();
      if (!applyRetroactively) {
        await conn.execute(
          `INSERT INTO system_settings_snapshots (effective_from_shamsi, settings_json, created_by_user_id)
           VALUES (?, ?, ?)`,
          [
            currentSettings.effective_from_shamsi,
            JSON.stringify(sanitizeSettingsForRole(currentSettings, "manager")),
            req.user.id
          ]
        );
      }
      await conn.execute(
        `UPDATE system_settings SET
          shift_start_time = ?,
          shift_end_time = ?,
          thursday_shift_start_time = ?,
          thursday_shift_end_time = ?,
          thursday_overtime_start_time = ?,
          grace_period_minutes = ?,
          break_duration_minutes = ?,
          working_days_json = ?,
          overtime_start_time = ?,
          overtime_before_shift = ?,
          mission_policy = ?,
          friday_holiday_policy = ?,
          official_holidays_json = ?,
          base_salary_toman = ?,
          hourly_rate_toman = ?,
          overtime_calc_mode = ?,
          overtime_percentage = ?,
          overtime_rate_toman = ?,
          late_deduction_unit = ?,
          late_deduction_rate_toman = ?,
          absence_deduction_unit = ?,
          absence_deduction_rate_toman = ?,
          collaboration_start_shamsi = ?,
          monthly_leave_quota_days = ?,
          sms_enabled = ?,
          sms_on_task_and_message = ?,
          melipayamak_username = ?,
          melipayamak_password = ?,
          melipayamak_from_number = ?,
          melipayamak_is_flash = ?,
          worker_phone_number = ?,
          rules_confirmed_by_manager = 1,
          effective_from_shamsi = ?,
          updated_by_user_id = ?
         WHERE id = ?`,
        [
          shiftStart,
          shiftEnd,
          thuStart,
          thuEnd,
          thuOtStart,
          gracePeriod,
          breakDuration,
          JSON.stringify(workingDays),
          overtimeStart,
          overtimeBeforeShift ? 1 : 0,
          missionPolicy,
          fridayHolidayPolicy,
          JSON.stringify(officialHolidays),
          baseSalaryToman,
          hourlyRate,
          overtimeCalcMode,
          overtimePercentage,
          overtimeRate,
          lateDeductionUnit,
          lateDeductionRateToman,
          absenceDeductionUnit,
          absenceDeductionRateToman,
          collaborationStartShamsi,
          monthlyLeaveQuotaDays,
          smsEnabled ? 1 : 0,
          smsOnTaskAndMessage ? 1 : 0,
          melipayamakUsername,
          melipayamakPassword,
          melipayamakFromNumber,
          melipayamakIsFlash ? 1 : 0,
          workerPhoneNumber,
          effectiveFromShamsi,
          req.user.id,
          currentSettings.id
        ]
      );
      await conn.execute(
        `UPDATE users SET collaboration_start_shamsi = ?, phone_number = ? WHERE role = 'worker'`,
        [collaborationStartShamsi, workerPhoneNumber || null]
      );
      const [updatedRows] = await conn.execute(
        "SELECT * FROM system_settings WHERE id = ?",
        [currentSettings.id]
      );
      const newSettings = sanitizeSettingsForRole(mapRowToSystemSettings(updatedRows[0]), "manager");
      await conn.commit();
      res.json({
        ok: true,
        settings: newSettings,
        message: "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0633\u0627\u0645\u0627\u0646\u0647 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0630\u062E\u06CC\u0631\u0647 \u0634\u062F."
      });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch {
        }
      }
      handleServerError(res, err);
    } finally {
      if (conn) conn.release();
    }
  }
);
apiRouter.post(
  "/settings/test-sms",
  requireAuth,
  requireRole("manager"),
  async (req, res) => {
    try {
      const currentSettings = await getSystemSettingsFromDb();
      const rawPass = String(req.body?.melipayamak_password ?? "").trim();
      const mergedSettings = {
        ...currentSettings,
        melipayamak_username: String(
          req.body?.melipayamak_username ?? currentSettings.melipayamak_username
        ),
        melipayamak_password: rawPass && rawPass !== "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" ? rawPass : currentSettings.melipayamak_password,
        melipayamak_from_number: String(
          req.body?.melipayamak_from_number ?? currentSettings.melipayamak_from_number
        ),
        melipayamak_is_flash: Boolean(
          req.body?.melipayamak_is_flash ?? currentSettings.melipayamak_is_flash
        ),
        worker_phone_number: String(
          req.body?.worker_phone_number ?? currentSettings.worker_phone_number
        )
      };
      const creditCheck = await checkMelipayamakCredit(
        mergedSettings.melipayamak_username,
        mergedSettings.melipayamak_password
      );
      const targetPhone = String(
        req.body?.test_phone || mergedSettings.worker_phone_number || ""
      ).trim();
      const testText = "\u067E\u06CC\u0627\u0645\u06A9 \u0622\u0632\u0645\u0627\u06CC\u0634\u06CC \u062C\u0647\u062A \u0628\u0631\u0631\u0633\u06CC \u0627\u062A\u0635\u0627\u0644 \u0633\u0627\u0645\u0627\u0646\u0647 \u0645\u062F\u06CC\u0631\u06CC\u062A \u06A9\u0627\u0631\u06A9\u0631\u062F (\u0645\u062F\u06CC\u0631\u06CC\u062A: \u0645\u062C\u06CC\u062F \u0646\u0648\u0631\u0627\u06CC\u06CC)";
      const result = await sendMelipayamakSms(
        mergedSettings,
        targetPhone,
        testText
      );
      const combinedMsg = creditCheck.ok ? `${creditCheck.message} \u2014 ${result.statusMessage}` : result.statusMessage;
      res.json({
        ok: result.sent,
        sent: result.sent,
        creditOk: creditCheck.ok,
        credit: creditCheck.credit ?? null,
        message: combinedMsg
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);
apiRouter.get(
  "/audit-logs",
  requireAuth,
  requireRole("manager"),
  async (_req, res) => {
    try {
      const pool2 = getPool();
      const [rows] = await pool2.execute(
        `SELECT a.*, u.full_name AS actor_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_user_id
         ORDER BY a.id DESC
         LIMIT 200`
      );
      res.json({
        ok: true,
        logs: rows.map((r) => ({
          id: Number(r.id),
          actor_user_id: r.actor_user_id ? Number(r.actor_user_id) : null,
          actor_name: r.actor_name || "\u0633\u06CC\u0633\u062A\u0645",
          action_type: String(r.action_type),
          target_entity: String(r.target_entity),
          target_id: r.target_id ? Number(r.target_id) : null,
          before_state: typeof r.before_state === "string" ? JSON.parse(r.before_state) : r.before_state,
          after_state: typeof r.after_state === "string" ? JSON.parse(r.after_state) : r.after_state,
          reason: r.reason ? String(r.reason) : null,
          ip_address: r.ip_address ? String(r.ip_address) : null,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : ""
        }))
      });
    } catch (err) {
      handleServerError(res, err);
    }
  }
);

// server.ts
var PRIVATE_MEDIA_FOLDERS = /* @__PURE__ */ new Set([
  "avatars",
  "attachments",
  "excel",
  "audio",
  "receipts",
  "reports"
]);
async function createApp() {
  validateProductionSecurityConfig(process.env);
  const app = (0, import_express2.default)();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(import_express2.default.json({ limit: "15mb" }));
  app.use((0, import_cookie_parser.default)());
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=()");
    next();
  });
  app.use((req, res, next) => {
    const cleanPath = decodeURIComponent(req.path || "").toLowerCase();
    if (cleanPath.startsWith("/.data") || cleanPath.startsWith("/backups") || cleanPath.startsWith("/database") || cleanPath.includes("/.env")) {
      res.status(403).json({
        ok: false,
        code: "FORBIDDEN",
        message: "\u062F\u0633\u062A\u0631\u0633\u06CC \u0645\u0633\u062A\u0642\u06CC\u0645 \u0628\u0647 \u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u0633\u06CC\u0633\u062A\u0645\u06CC \u0648 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A."
      });
      return;
    }
    next();
  });
  const privateBaseDir = import_path4.default.resolve(process.cwd(), ".data/private_media");
  const legacyPublicMediaDir = import_path4.default.resolve(process.cwd(), "public/assets/media");
  for (const folder of PRIVATE_MEDIA_FOLDERS) {
    try {
      import_fs4.default.mkdirSync(import_path4.default.join(privateBaseDir, folder), { recursive: true, mode: 448 });
    } catch {
    }
  }
  migrateLegacyPublicMediaToPrivate();
  app.use("/api", async (req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }
    if (!isDatabaseInitialized()) {
      await waitForPendingDatabaseInit();
    }
    if (!isDatabaseInitialized()) {
      res.status(503).json({
        ok: false,
        dbConnected: false,
        code: "DB_UNAVAILABLE",
        message: "\u067E\u0627\u06CC\u06AF\u0627\u0647 \u062F\u0627\u062F\u0647 \u0647\u0646\u0648\u0632 \u0622\u0645\u0627\u062F\u0647 \u0628\u0647\u0631\u0647\u200C\u0628\u0631\u062F\u0627\u0631\u06CC \u0646\u06CC\u0633\u062A \u06CC\u0627 \u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u0633\u0631\u0648\u0631 \u0628\u0631\u0642\u0631\u0627\u0631 \u0646\u0634\u062F."
      });
      return;
    }
    next();
  });
  app.use("/api", requireCsrfProtection, apiRouter);
  app.get("/assets/media/:folder/:filename", async (req, res) => {
    try {
      const folder = String(req.params.folder || "").trim();
      const filename = String(req.params.filename || "").trim();
      if (!PRIVATE_MEDIA_FOLDERS.has(folder) || !filename || filename.includes("..") || filename.includes("/") || filename.includes("\\") || filename.includes("\0")) {
        res.status(400).json({ ok: false, message: "\u0645\u0633\u06CC\u0631 \u0641\u0627\u06CC\u0644 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        return;
      }
      if (!isDatabaseInitialized()) {
        res.status(503).json({
          ok: false,
          code: "DB_UNAVAILABLE",
          message: "\u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u067E\u0627\u06CC\u06AF\u0627\u0647 \u062F\u0627\u062F\u0647 \u0628\u0631\u0642\u0631\u0627\u0631 \u0646\u06CC\u0633\u062A."
        });
        return;
      }
      const session = await getSessionUser(req);
      if (!session) {
        res.status(401).json({
          ok: false,
          code: "UNAUTHORIZED",
          message: "\u062F\u0633\u062A\u0631\u0633\u06CC \u0645\u0633\u062A\u0642\u06CC\u0645 \u0628\u062F\u0648\u0646 \u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u0628\u0647 \u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u062E\u0635\u0648\u0635\u06CC \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A."
        });
        return;
      }
      const fileUrl = `/assets/media/${folder}/${filename}`;
      const pool2 = getPool();
      if (session.user.role !== "manager") {
        let authorized = false;
        const uid = session.user.id;
        if (folder === "receipts") {
          const [rows] = await pool2.execute(
            "SELECT id FROM financial_transactions WHERE receipt_file_url = ? AND user_id = ? LIMIT 1",
            [fileUrl, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === "reports") {
          const [rows] = await pool2.execute(
            "SELECT id FROM daily_work_reports WHERE photo_url = ? AND user_id = ? LIMIT 1",
            [fileUrl, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === "excel") {
          const [rows] = await pool2.execute(
            "SELECT id FROM historical_work_records WHERE excel_file_url = ? AND user_id = ? LIMIT 1",
            [fileUrl, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === "audio") {
          const [rows] = await pool2.execute(
            "SELECT id FROM work_correspondences WHERE audio_url = ? AND (sender_user_id = ? OR receiver_user_id = ?) LIMIT 1",
            [fileUrl, uid, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === "attachments") {
          const [rows] = await pool2.execute(
            "SELECT id FROM work_correspondences WHERE attachments_json LIKE ? AND (sender_user_id = ? OR receiver_user_id = ?) LIMIT 1",
            [`%${filename}%`, uid, uid]
          );
          authorized = rows.length > 0;
        } else if (folder === "avatars") {
          const [rows] = await pool2.execute(
            "SELECT id FROM users WHERE avatar_url = ? LIMIT 1",
            [fileUrl]
          );
          authorized = rows.length > 0;
        }
        if (!authorized) {
          res.status(403).json({
            ok: false,
            code: "FORBIDDEN",
            message: "\u0634\u0645\u0627 \u0645\u062C\u0648\u0632 \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u0647 \u0627\u06CC\u0646 \u0641\u0627\u06CC\u0644 \u062E\u0635\u0648\u0635\u06CC \u0631\u0627 \u0646\u062F\u0627\u0631\u06CC\u062F."
          });
          return;
        }
      }
      const activePrivateBase = process.env.PRIVATE_MEDIA_DIR ? import_path4.default.resolve(process.cwd(), process.env.PRIVATE_MEDIA_DIR) : privateBaseDir;
      const candidatePrivate = import_path4.default.resolve(activePrivateBase, folder, filename);
      const candidateLegacy = import_path4.default.resolve(legacyPublicMediaDir, folder, filename);
      if (!candidatePrivate.startsWith(import_path4.default.resolve(activePrivateBase, folder)) || !candidateLegacy.startsWith(import_path4.default.resolve(legacyPublicMediaDir, folder))) {
        res.status(400).json({ ok: false, message: "\u0645\u0633\u06CC\u0631 \u0641\u0627\u06CC\u0644 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A." });
        return;
      }
      const targetPath = import_fs4.default.existsSync(candidatePrivate) ? candidatePrivate : import_fs4.default.existsSync(candidateLegacy) ? candidateLegacy : null;
      if (!targetPath) {
        res.status(404).json({ ok: false, message: "\u0641\u0627\u06CC\u0644 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F." });
        return;
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      res.sendFile(targetPath);
    } catch {
      res.status(500).json({ ok: false, message: "\u062E\u0637\u0627 \u062F\u0631 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0641\u0627\u06CC\u0644." });
    }
  });
  app.use("/assets/media/:folder", (req, res, next) => {
    const folder = String(req.params.folder || "").trim();
    if (PRIVATE_MEDIA_FOLDERS.has(folder)) {
      res.status(403).json({ ok: false, message: "\u062F\u0633\u062A\u0631\u0633\u06CC \u0645\u0633\u062A\u0642\u06CC\u0645 \u0628\u0647 \u067E\u0648\u0634\u0647 \u062E\u0635\u0648\u0635\u06CC \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A." });
      return;
    }
    next();
  });
  const publicDir = import_path4.default.resolve(process.cwd(), "public");
  app.use(import_express2.default.static(publicDir));
  return app;
}
async function startServer() {
  validateProductionSecurityConfig(process.env);
  initializeDatabase().then(() => {
    console.log(
      "[MGAMMON Duo] MySQL/MariaDB database initialized and verified prior to accepting requests."
    );
  }).catch((err) => {
    console.error(
      "[MGAMMON Duo] Database initialization failed during startup:",
      sanitizeDbErrorMessage(err)
    );
  });
  const app = await createApp();
  const PORT = Number(process.env.PORT || 3e3);
  const isBundledRuntime = typeof __filename === "string" && import_path4.default.basename(__filename) === "app.cjs" || (process.argv[1] ? import_path4.default.basename(process.argv[1]) === "app.cjs" : false);
  const isProductionMode = process.env.NODE_ENV === "production" || isBundledRuntime;
  if (!isProductionMode) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path4.default.resolve(process.cwd(), "dist");
    app.use(import_express2.default.static(distPath));
    app.use("/api", (_req, res) => {
      res.status(404).json({
        ok: false,
        code: "NOT_FOUND",
        message: "\u0645\u0633\u06CC\u0631 \u0648\u0628\u200C\u0633\u0631\u0648\u06CC\u0633 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F."
      });
    });
    app.get("*", (_req, res) => {
      res.sendFile(import_path4.default.join(distPath, "index.html"));
    });
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MGAMMON Duo] Server running on http://0.0.0.0:${PORT}`);
  });
  return server;
}
if (process.env.VITEST !== "true") {
  startServer();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createApp,
  startServer
});
