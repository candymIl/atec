import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const target = (__ENV.BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const apiPrefix = (__ENV.API_PREFIX || "").replace(/^\/?/, "/").replace(/\/$/, "");
const allowNonLocalTarget = String(__ENV.ALLOW_NON_LOCAL_TARGET || "").toLowerCase() === "true";
const authCookie = __ENV.ATEC_AUTH_COOKIE || "";

const nonLocalTarget = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(target);

if (nonLocalTarget && !allowNonLocalTarget) {
  throw new Error(
    "Refusing to run against a non-local target. Set ALLOW_NON_LOCAL_TARGET=true only for an approved test environment."
  );
}

if (!authCookie) {
  throw new Error("Set ATEC_AUTH_COOKIE to a valid test-session cookie. Do not hard-code credentials or tokens.");
}

export const options = {
  scenarios: {
    readonly_readiness: {
      executor: "ramping-vus",
      stages: [
        { duration: "1m", target: 3 },
        { duration: "2m", target: 10 },
        { duration: "5m", target: 10 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["avg<500", "p(95)<1500"],
    checks: ["rate>0.99"],
  },
};

const apiErrorRate = new Rate("atec_api_errors");
const dashboardTrend = new Trend("atec_dashboard_duration");
const assetSearchTrend = new Trend("atec_asset_search_duration");
const quickDetailsTrend = new Trend("atec_quick_details_duration");
const certificateSearchTrend = new Trend("atec_certificate_search_duration");

const searchTerms = (__ENV.SEARCH_TERMS || "crane,hoist,chain,load,atec")
  .split(",")
  .map((term) => term.trim())
  .filter(Boolean);

const headers = {
  Cookie: authCookie,
  Accept: "application/json",
};

function api(path) {
  return `${target}${apiPrefix}${path}`;
}

function record(name, response, trend) {
  trend.add(response.timings.duration);
  const ok = check(response, {
    [`${name} returned 2xx`]: (res) => res.status >= 200 && res.status < 300,
  });
  apiErrorRate.add(!ok);
}

function getJson(name, path, trend) {
  const response = http.get(api(path), { headers, timeout: "30s" });
  record(name, response, trend);
  return response;
}

export default function () {
  const term = searchTerms[Math.floor(Math.random() * searchTerms.length)] || "crane";

  getJson("dashboard stats", "/dashboard/stats", dashboardTrend);

  if (Math.random() < 0.6) {
    getJson("dashboard alerts", "/dashboard/alerts", dashboardTrend);
  }

  if (Math.random() < 0.5) {
    getJson("dashboard failed equipment", "/dashboard/failed-equipment-by-customer", dashboardTrend);
  }

  if (Math.random() < 0.5) {
    getJson("dashboard upcoming expiries", "/dashboard/upcoming-expiries-by-customer", dashboardTrend);
  }

  const assetSearch = getJson(
    "asset list search",
    `/assets?page=1&limit=25&searchBy=all&search=${encodeURIComponent(term)}&archiveMode=active`,
    assetSearchTrend
  );

  let assetId = null;
  try {
    const body = assetSearch.json();
    assetId = body?.rows?.[0]?.assetid || null;
  } catch (_) {
    assetId = null;
  }

  getJson(
    "inspection asset picker",
    `/inspections/assets/search?q=${encodeURIComponent(term)}`,
    assetSearchTrend
  );

  if (assetId) {
    getJson("asset quick details", `/assets/${assetId}/quick-details`, quickDetailsTrend);
  }

  getJson(
    "certificate search",
    `/certificates/search?search=${encodeURIComponent(term)}&inspectiontype=&status=&clientid=&siteid=&sectionid=&datefrom=&dateto=`,
    certificateSearchTrend
  );

  sleep(Math.random() * 2 + 1);
}
