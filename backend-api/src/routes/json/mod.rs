/// this module has objects that are to be returned from API as json.
pub mod analytics;
pub mod assistant;
pub mod listening;
pub mod metadata_tag;
pub mod privacy;
pub mod profile;
pub mod query;
pub mod saved_query;
pub mod settings;
pub mod social;
pub mod tag;
pub mod user_data;

/// convert a `Vec<A>` into a `Vec<B>``
pub fn vec_into<A, B>(v: Vec<A>) -> Vec<B>
where
    A: Into<B>,
{
    v.into_iter().map(Into::into).collect()
}
