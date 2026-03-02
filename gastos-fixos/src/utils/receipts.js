export async function uploadReceiptFile({ supabase, file, userId }) {
  if (!file) return { publicUrl: null };

  const ext = file.name?.split('.').pop() || 'bin';
  const safeName = (file.name || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${userId}/${Date.now()}-${safeName}.${ext}`.replace(/\.+/g, '.');

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });

  if (uploadError) return { publicUrl: null, error: uploadError };

  const { data } = supabase.storage.from('receipts').getPublicUrl(path);
  return { publicUrl: data?.publicUrl || null, path };
}
