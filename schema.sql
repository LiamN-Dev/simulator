-- Core User Management
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'student', -- 'admin' or 'student'
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'locked'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Course Structure
CREATE TABLE courses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20),
    period VARCHAR(20),
    color_hex VARCHAR(7) DEFAULT '#3B82F6'
);

CREATE TABLE user_courses (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, course_id)
);

-- Units & Content Hierarchy
CREATE TABLE units (
    id SERIAL PRIMARY KEY,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    order_index INT DEFAULT 0,
    is_visible BOOLEAN DEFAULT TRUE
);

CREATE TABLE resources (
    id SERIAL PRIMARY KEY,
    unit_id INT REFERENCES units(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    resource_type VARCHAR(50) DEFAULT 'link', -- 'pdf', 'slides', 'quizlet', 'video', 'link'
    visibility_scope VARCHAR(20) DEFAULT 'course', -- 'course', 'restricted'
    unlock_at TIMESTAMP NULL,
    due_date TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE resource_permissions (
    resource_id INT REFERENCES resources(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (resource_id, user_id)
);

-- Unlock Requests
CREATE TABLE unlock_requests (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    resource_id INT REFERENCES resources(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'denied'
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- In-App Mandatory Popups
CREATE TABLE popups (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    target_type VARCHAR(20) DEFAULT 'global', -- 'global', 'course', 'user'
    target_id INT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE popup_acknowledgments (
    popup_id INT REFERENCES popups(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (popup_id, user_id)
);

-- Customized Banners & Overrides
CREATE TABLE banners (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE NULL,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE NULL,
    message TEXT NOT NULL,
    due_date TIMESTAMP NULL,
    is_override BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
