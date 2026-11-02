const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, count, error } = await supabase
    .from('bridge_transactions')
    .select('id, wallet_address, source_chain, destination_chain, bridge_status, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('Total bridge transactions count:', count);
  console.log('Sample rows:', data);
  if (error) console.error('Error:', error);
}

main().catch(console.error);

