/// this module has objects that are to be returned from API as json.
pub mod tag;

/// convert a `Vec<A>` into a `Vec<B>``
pub fn vec_into<A, B>(v: Vec<A>) -> Vec<B>
where
    A: Into<B>,
{
    v.into_iter().map(Into::into).collect()
}
