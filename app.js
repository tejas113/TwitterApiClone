const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log(`Server is running at http://localhost:3000/`);
    });
  } catch (e) {
    console.log(`Error DB: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401).send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401).send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;

  if (password.length < 6) {
    return response.status(400).send("Password is too short");
  }
  const selectUserQuery = `SELECT * FROM user WHERE username='${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const createUserQuery = `
            INSERT INTO
                user (username,password,name, gender)
            VALUES(
                '${username}',
                '${hashedPassword}',
                '${name}',
                '${gender}'
            );`;
    await db.run(createUserQuery);
    response.send("User created successfully");
  } else {
    response.status(400).send("User already exists");
  }
});

app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username='${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400).send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400).send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const loggedInUser = request.username;
  const followingUserTweets = `
  SELECT user.username, tweet.tweet, tweet.date_time as dateTime
  FROM tweet JOIN user ON user.user_id = tweet.user_id
  WHERE 
  tweet.user_id IN (
      SELECT following_user_id
      FROM follower
      JOIN user ON user.user_id = follower.follower_user_id
      WHERE user.username = '${loggedInUser}'
  )
  ORDER BY
    tweet.date_time DESC
  LIMIT 4
    ;`;
  const result = await db.all(followingUserTweets);
  response.send(result);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const loggedInUser = request.username;
  const queryToGetUserFollowing = `
    SELECT name
    FROM user INNER JOIN follower
    ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = (
        SELECT user_id FROM user WHERE username = '${loggedInUser}'
    );`;
  const result = await db.all(queryToGetUserFollowing);
  response.send(result);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const loggedInUser = request.username;
  const queryToGetUserFollowers = `
    SELECT name
    FROM user INNER JOIN follower
    ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = (
        SELECT user_id FROM user WHERE username = '${loggedInUser}'
    );`;
  const result = await db.all(queryToGetUserFollowers);
  response.send(result);
});

app.get("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const loggedInUser = request.username;
  const { tweetId } = request.params;
  const checkFollowingQuery = `
        SELECT 1
        FROM follower
        JOIN tweet ON follower.following_user_id = tweet.user_id
        WHERE follower.follower_user_id = (
            SELECT user_id FROM user WHERE username = '${loggedInUser}'
        ) AND tweet.tweet_id = ${tweetId};
    `;
  const isFollowing = await db.get(checkFollowingQuery);

  if (!isFollowing) {
    return response.status(401).send("Invalid Request");
  }

  const getParticularTweet = `
        SELECT 
            tweet,
            (SELECT COUNT(*) FROM like WHERE tweet_id = ${tweetId}) as likes,
            (SELECT COUNT(*) FROM reply WHERE tweet_id = ${tweetId}) as replies,
            tweet.date_time as dateTime
        FROM tweet
        WHERE tweet.tweet_id = ${tweetId};
    `;

  const result = await db.get(getParticularTweet);
  if (result) {
    response.send(result);
  } else {
    response.status(404).send("Tweet not found");
  }
});

app.get(
  "/tweets/:tweetId/likes",
  authenticateToken,
  async (request, response) => {
    const loggedInUser = request.username;
    const { tweetId } = request.params;

    const checkFollowingQuery = `
        SELECT 1
        FROM follower
        JOIN tweet ON follower.following_user_id = tweet.user_id
        WHERE follower.follower_user_id = (
            SELECT user_id FROM user WHERE username = '${loggedInUser}'
        ) AND tweet.tweet_id = ${tweetId};
    `;
    const isFollowing = await db.get(checkFollowingQuery);

    if (!isFollowing) {
      return response.status(401).send("Invalid Request");
    }

    const getLikedUsersQuery = `
        SELECT user.username
        FROM like
        JOIN user ON like.user_id = user.user_id
        WHERE like.tweet_id = ${tweetId};
    `;

    const likedUsers = await db.all(getLikedUsersQuery);
    const responseData = {
      likes: likedUsers.map((user) => user.username),
    };

    response.send(responseData);
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const loggedInUser = request.username;
    const checkFollowingQuery = `
        SELECT 1
        FROM follower
        JOIN tweet ON follower.following_user_id = tweet.user_id
        WHERE follower.follower_user_id = (
            SELECT user_id FROM user WHERE username = '${loggedInUser}'
        ) AND tweet.tweet_id = ${tweetId};
    `;
    const isFollowing = await db.get(checkFollowingQuery);

    if (!isFollowing) {
      return response.status(401).send("Invalid Request");
    }

    const getRepliedUsers = `
        SELECT user.name as name, reply.reply as reply
        FROM reply
        INNER JOIN user ON reply.user_id = user.user_id
        WHERE reply.tweet_id = ${tweetId};
    `;

    const repliesUsers = await db.all(getRepliedUsers);
    const responseData = {
      replies: repliesUsers.map((user) => ({
        name: user.name,
        reply: user.reply,
      })),
    };
    response.send(responseData);
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const loggedInUsername = request.username;
  const getAllTweetsOfUser = `
    SELECT 
            tweet,
            (SELECT COUNT(*) FROM like WHERE tweet_id = tweet.tweet_id) as likes,
            (SELECT COUNT(*) FROM reply WHERE tweet_id = tweet.tweet_id) as replies,
            tweet.date_time as dateTime
        FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE user.username = '${loggedInUsername}';
    `;
  const result = await db.all(getAllTweetsOfUser);
  response.send(result);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const loggedInUsername = request.username;
  const createTweetQuery = `
        INSERT INTO tweet (tweet,user_id,date_time)
        VALUES ('${tweet}', (SELECT user_id FROM user WHERE username = '${loggedInUsername}'), datetime('now'));
    `;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const loggedInUsername = request.username;
    const checkOwnerOfTweet = `
        SELECT 1
        FROM tweet
        JOIN user ON tweet.user_id = user.user_id
        WHERE tweet.tweet_id = ${tweetId} AND user.username = '${loggedInUsername}';
    `;

    const isUserTweet = await db.get(checkOwnerOfTweet);

    if (!isUserTweet) {
      return response.status(401).send("Invalid Request");
    }

    const deleteTweetQuery = `
        DELETE FROM tweet 
        WHERE tweet_id = ${tweetId}        
    `;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
);

app.get("/", async (request, response) => {
  const getAllUsers = `SELECT * FROM user`;
  const res = await db.all(getAllUsers);
  response.send(res);
});

module.exports = app;
