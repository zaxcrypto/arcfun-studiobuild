const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const time = '2026-11-01T08:44:16.520826+00:00';
  const id = '29710259-3df2-4410-abd1-3513c12fe449';
  const { data, error } = await supabase
    .from('bridge_transactions')
    .select('id, created_at')
    .or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${id})`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(5);

  console.log('PostgREST or query result count:', data?.length);
  if (data) console.log('Rows:', data);
  if (error) console.error('Error:', error);
}

test();

