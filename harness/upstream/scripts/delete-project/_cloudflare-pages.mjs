// _cloudflare-pages.mjs - Every page of a Cloudflare list, for the /delete-project inventory
// (discover-resources.mjs).
//
// Read on a real account on 14/10/2026: routing rules and destination addresses serve 50 at most,
// cut a larger page size down in silence, and give a total but no number of pages; zones and
// accounts are documented at 50 per page; DNS records take far more. Before 3.4.12 the inventory
// read ONE page of each: an account with more than 50 zones, a zone with more than 200 records or
// with more than 50 routing rules hid the rest, and a zone that could not be read passed for an
// empty one. A page that fails now fails the read, said in `error`: never "nothing found" for
// "not read".

/**
 * @param {string} path  the list's path under the API, e.g. "/zones" or "/zones/<id>/dns_records"
 * @param {number} size  the page size asked, never above what Cloudflare documents for that list
 * @param {(url: string) => Promise<object>} getJson  the caller's reader: the answer's JSON, or
 *   {__error} when the HTTP status is not a success
 * @returns {Promise<{items: object[], error?: string}>}
 */
export async function cloudflareAll(path, size, getJson) {
  const items = [];
  for (let page = 1; page <= 200; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await getJson(`https://api.cloudflare.com/client/v4${path}${sep}per_page=${size}&page=${page}`);
    if (data?.__error) return { items, error: data.__error };
    if (!data || data.success === false) return { items, error: (data?.errors || []).map((e) => e.message).join("; ") || "API returned success:false" };
    const got = Array.isArray(data.result) ? data.result : [];
    items.push(...got);
    // The number of pages where Cloudflare gives it; else the total over the size it actually
    // served; else a full page asks for the next one.
    const info = data.result_info || {};
    const served = Number(info.per_page) > 0 ? Number(info.per_page) : size;
    const total = info.total_count === undefined || info.total_count === null ? null : Number(info.total_count);
    const pages = Number(info.total_pages) > 0 ? Number(info.total_pages) : total !== null && Number.isFinite(total) ? Math.max(1, Math.ceil(total / served)) : null;
    if (!got.length || (pages !== null ? page >= pages : got.length < served)) return { items };
  }
  return { items, error: "more pages than the inventory reads" };
}
