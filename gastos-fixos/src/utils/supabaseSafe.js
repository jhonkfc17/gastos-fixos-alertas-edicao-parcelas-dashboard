/**
 * Helpers to keep the UI working even if the DB schema is not yet updated.
 * If a request fails due to missing column (PostgREST 400), we retry removing that column.
 */

export function isMissingColumnError(error, columnName) {
  const msg = (error?.message || error?.details || '').toLowerCase();
  return msg.includes('does not exist') && msg.includes(columnName.toLowerCase());
}

export async function safeInsert(supabase, table, row, fallbackRow, onError) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (!error) return { data, error: null };

  if (fallbackRow) {
    const { data: data2, error: error2 } = await supabase.from(table).insert(fallbackRow).select().single();
    if (!error2) return { data: data2, error: null };
    if (onError) onError(error2);
    return { data: null, error: error2 };
  }

  if (onError) onError(error);
  return { data: null, error };
}

export async function safeSelect(supabase, table, selectA, selectB, opts = {}) {
  const q1 = supabase.from(table).select(selectA);
  const q2 = selectB ? supabase.from(table).select(selectB) : null;

  if (opts.orderBy) q1.order(opts.orderBy.col, { ascending: opts.orderBy.ascending ?? false });
  if (opts.eq) q1.eq(opts.eq.col, opts.eq.val);

  const { data, error } = await q1;
  if (!error) return { data, error: null };

  if (q2) {
    if (opts.orderBy) q2.order(opts.orderBy.col, { ascending: opts.orderBy.ascending ?? false });
    if (opts.eq) q2.eq(opts.eq.col, opts.eq.val);
    const { data: data2, error: error2 } = await q2;
    return { data: data2, error: error2 };
  }

  return { data: null, error };
}
