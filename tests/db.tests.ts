import { pool } from '../src/infrastructure/database/pool.js';

async function testConnection() {
  console.log('🔄 Connecting to PostgreSQL...');

  try {
    const result = await pool.query(`
      SELECT
        NOW() AS server_time,
        current_database() AS database_name;
    `);

    const { server_time, database_name } = result.rows[0];

    console.log('✅ PostgreSQL connection successful');
    console.log(`🕒 Server Time: ${server_time}`);
    console.log(`🗄️ Database: ${database_name}`);

    if (database_name !== 'zolt-jobscheduler') {
      throw new Error(`Connected to unexpected database: ${database_name}`);
    }

    console.log('🎉 Target database verified');
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
    console.log('🛑 PostgreSQL pool closed');
  }
}

testConnection();
