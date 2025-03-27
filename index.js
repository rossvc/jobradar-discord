require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");
const cron = require("node-cron");

// Configure Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Configure database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Discord channel IDs - replace with your actual channel IDs
const CHANNEL_IDS = {
  SENIOR: process.env.DISCORD_CHANNEL_SENIOR,
  EARLY_CAREER: process.env.DISCORD_CHANNEL_EARLY_CAREER,
  NEW_GRAD: process.env.DISCORD_CHANNEL_NEW_GRAD,
  INTERNSHIPS: process.env.DISCORD_CHANNEL_INTERNSHIPS,
};

// Connect to Discord
client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  startJobPostingSchedule();
});

// Function to fetch jobs that are 6 hours old
async function getJobsToPost() {
  const client = await pool.connect();
  try {
    // Find jobs that were added 6-7 hours ago and haven't been posted to Discord yet
    const query = `
      SELECT 
        id, job_title, job_company, job_location, remote_status, 
        experience_level, url, salary_range_min, salary_range_max,
        created_at
      FROM job_analysis 
      WHERE 
        created_at BETWEEN NOW() - INTERVAL '7 hours' AND NOW() - INTERVAL '6 hours'
        AND is_software_engineering = true 
        AND is_active = true
        AND is_us = true
        AND posted_to_discord = false
      ORDER BY created_at DESC
    `;

    const result = await client.query(query);
    return result.rows;
  } catch (err) {
    console.error("Database query error:", err);
    return [];
  } finally {
    client.release();
  }
}

// Mark jobs as posted to Discord
async function markJobsAsPosted(jobIds) {
  if (jobIds.length === 0) return;

  const client = await pool.connect();
  try {
    const query = `
      UPDATE job_analysis 
      SET posted_to_discord = true 
      WHERE id = ANY($1);
    `;

    await client.query(query, [jobIds]);
    console.log(`Marked ${jobIds.length} jobs as posted to Discord`);
  } catch (err) {
    console.error("Error marking jobs as posted:", err);
  } finally {
    client.release();
  }
}

// Create a Discord embed for a job
function createJobEmbed(job) {
  const { encodeJobUrl } = require("./utils/urlUtils");
  const redirectUrl = `/redirect/${encodeJobUrl(job.url)}`;
  const fullRedirectUrl = `https://jobradar.live${redirectUrl}`;

  // Format salary if available
  let salaryText = "Salary not provided";
  if (job.salary_range_min > 0 && job.salary_range_max > 0) {
    salaryText = `$${job.salary_range_min.toLocaleString()} - $${job.salary_range_max.toLocaleString()}`;
  } else if (job.salary_range_min > 0) {
    salaryText = `$${job.salary_range_min.toLocaleString()}+`;
  } else if (job.salary_range_max > 0) {
    salaryText = `Up to $${job.salary_range_max.toLocaleString()}`;
  }

  // Format remote status
  let remoteStatus = job.remote_status
    ? job.remote_status.charAt(0).toUpperCase() + job.remote_status.slice(1)
    : "Not specified";

  // Set color based on experience level
  let color = 0x6d28d9;
  let locations_value = job.job_location;
  if (locations_value.length > 1024) {
    locations_value = locations_value.slice(0, 1021) + "...";
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${job.job_title}`)
    .setURL(fullRedirectUrl)
    .setAuthor({ name: job.job_company })
    .addFields(
      {
        name: "Location",
        value: locations_value || "Not specified",
        inline: true,
      },
      { name: "Remote", value: remoteStatus, inline: true },
      { name: "Salary", value: salaryText }
    )
    .setFooter({ text: "JobRadar · Apply now" })
    .setTimestamp(new Date(job.created_at));
}

// Post jobs to appropriate Discord channels
async function postJobsToDiscord() {
  console.log("Checking for jobs to post to Discord...");
  const jobs = await getJobsToPost();

  if (jobs.length === 0) {
    console.log("No new jobs to post at this time.");
    return;
  }

  console.log(`Found ${jobs.length} jobs to post to Discord.`);
  const postedJobIds = [];

  // Group jobs by experience level
  const jobsByCategory = {
    senior: [],
    "early career": [],
    "new grad": [],
    internship: [],
  };

  // Categorize jobs
  jobs.forEach((job) => {
    // Add to appropriate experience level category
    if (job.experience_level && jobsByCategory[job.experience_level]) {
      jobsByCategory[job.experience_level].push(job);
    } else if (
      job.experience_level === "senior" ||
      !job.experience_level ||
      !jobsByCategory[job.experience_level]
    ) {
      // Default to senior category if experience level is 'senior' or not specified
      jobsByCategory["senior"].push(job);
    }

    postedJobIds.push(job.id);
  });

  // Post to each channel
  try {
    // Post to senior channel
    if (jobsByCategory["senior"].length > 0 && CHANNEL_IDS.SENIOR) {
      const channel = await client.channels.fetch(CHANNEL_IDS.SENIOR);
      if (channel) {
        // Post up to 10 jobs to avoid spam
        for (const job of jobsByCategory["senior"]) {
          await channel.send({ embeds: [createJobEmbed(job)] });
          // Small delay to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // Post to early career channel
    if (jobsByCategory["early career"].length > 0 && CHANNEL_IDS.EARLY_CAREER) {
      const channel = await client.channels.fetch(CHANNEL_IDS.EARLY_CAREER);
      if (channel) {
        for (const job of jobsByCategory["early career"]) {
          await channel.send({ embeds: [createJobEmbed(job)] });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // Post to new grad channel
    if (jobsByCategory["new grad"].length > 0 && CHANNEL_IDS.NEW_GRAD) {
      const channel = await client.channels.fetch(CHANNEL_IDS.NEW_GRAD);
      if (channel) {
        for (const job of jobsByCategory["new grad"]) {
          await channel.send({ embeds: [createJobEmbed(job)] });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // Post to internships channel
    if (jobsByCategory["internship"].length > 0 && CHANNEL_IDS.INTERNSHIPS) {
      const channel = await client.channels.fetch(CHANNEL_IDS.INTERNSHIPS);
      if (channel) {
        for (const job of jobsByCategory["internship"]) {
          await channel.send({ embeds: [createJobEmbed(job)] });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // Mark all jobs as posted
    await markJobsAsPosted(postedJobIds);
  } catch (error) {
    console.error("Error posting jobs to Discord:", error);
  }
}

// Schedule job posting to run every hour
function startJobPostingSchedule() {
  console.log("Starting job posting schedule...");

  // Run every hour at the 15-minute mark
  cron.schedule("1 * * * *", async () => {
    console.log("Running scheduled job posting task...");
    await postJobsToDiscord();
  });

  // Also run immediately on startup for testing
  postJobsToDiscord();
}

// Add this column to your database if it doesn't exist
async function ensureDiscordColumnExists() {
  const client = await pool.connect();
  try {
    // Check if column exists
    const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'job_analysis' AND column_name = 'posted_to_discord';
    `;

    const result = await client.query(checkQuery);

    if (result.rows.length === 0) {
      console.log("Adding posted_to_discord column to job_analysis table...");
      await client.query(`
        ALTER TABLE job_analysis 
        ADD COLUMN posted_to_discord BOOLEAN DEFAULT false;
      `);
      console.log("Column added successfully.");
    } else {
      console.log("posted_to_discord column already exists.");
    }
  } catch (err) {
    console.error("Error ensuring Discord column exists:", err);
  } finally {
    client.release();
  }
}

// Error handling
client.on("error", console.error);

// Initialize and start bot
async function initialize() {
  try {
    await ensureDiscordColumnExists();
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error("Failed to initialize:", error);
  }
}

initialize();
