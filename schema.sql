-- Users table (Privacy-first: No emails required)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    display_name VARCHAR(100) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'student', -- 'admin' or 'student'
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'suspended'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20),
    period VARCHAR(20),
    color_hex VARCHAR(10) DEFAULT '#3b82f6'
);

-- User-Course Permission Matrix
CREATE TABLE IF NOT EXISTS user_courses (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, course_id)
);

-- Units table
CREATE TABLE IF NOT EXISTS units (
    id SERIAL PRIMARY KEY,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    order_index INT DEFAULT 1,
    is_visible BOOLEAN DEFAULT TRUE
);

-- Resources / Study Materials table
CREATE TABLE IF NOT EXISTS resources (
    id SERIAL PRIMARY KEY,
    unit_id INT REFERENCES units(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    url TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'link', -- 'pdf', 'doc', 'quizlet', 'slides', 'video', 'link'
    visibility_scope VARCHAR(20) DEFAULT 'course', -- 'course', 'restricted', 'draft'
    unlock_at TIMESTAMP NULL,
    lock_after TIMESTAMP NULL,
    due_at TIMESTAMP NULL
);

-- Resource-level Specific User Permissions
CREATE TABLE IF NOT EXISTS resource_permissions (
    resource_id INT REFERENCES resources(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (resource_id, user_id)
);

-- Locked Vault Unlock Requests
CREATE TABLE IF NOT EXISTS unlock_requests (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    resource_id INT REFERENCES resources(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'denied'
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mandatory In-App Popups
CREATE TABLE IF NOT EXISTS popups (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    target_type VARCHAR(20) DEFAULT 'global', -- 'global', 'course', 'user'
    target_id INT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Mandatory Popup Read Receipts
CREATE TABLE IF NOT EXISTS popup_acknowledgments (
    popup_id INT REFERENCES popups(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (popup_id, user_id)
);

-- Personalized Dashboard Banner Overrides
CREATE TABLE IF NOT EXISTS banner_overrides (
    id SERIAL PRIMARY KEY,
    target_type VARCHAR(20) DEFAULT 'global', -- 'global', 'course', 'user'
    target_id INT NULL,
    message TEXT NOT NULL,
    due_title VARCHAR(255) NULL,
    due_at TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
