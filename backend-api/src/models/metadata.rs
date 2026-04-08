
use chrono::{DateTime, Utc};

pub struct Metadata {
    pub title : Option<String>,
    pub	artist : Option<String>,
    pub	album : Option<String>,
    pub	duration : Option<String>,
    pub	release_date: Option<DateTime<Utc>>,
    pub	explicit : Option<String>,
}
