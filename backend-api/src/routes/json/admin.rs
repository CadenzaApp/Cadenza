use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlatformRole {
    User,
    Moderator,
    Admin,
    Owner,
}

impl PlatformRole {
    pub fn name(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Moderator => "moderator",
            Self::Admin => "admin",
            Self::Owner => "owner",
        }
    }
    pub fn dashboard(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }
    pub fn can_change(self, current: Self, desired: Self) -> bool {
        match self {
            Self::Owner => current != Self::Owner && desired != Self::Owner,
            Self::Admin => {
                matches!(current, Self::User | Self::Moderator)
                    && matches!(desired, Self::User | Self::Moderator)
            }
            _ => false,
        }
    }
}

#[derive(Serialize)]
pub struct RoleAccess {
    pub role: PlatformRole,
    pub dashboard: bool,
    pub allowed_roles: Vec<PlatformRole>,
}

#[derive(Deserialize)]
pub struct ChangeRole {
    pub role: PlatformRole,
    pub expected_role: PlatformRole,
}

#[cfg(test)]
mod tests {
    use super::PlatformRole::*;
    #[test]
    fn staff_capabilities_and_protected_roles() {
        for (actor, current, desired) in [
            (Owner, User, Admin),
            (Owner, Moderator, Admin),
            (Owner, Admin, User),
            (Owner, Admin, Moderator),
            (Admin, User, Moderator),
            (Admin, Moderator, User),
        ] {
            assert!(actor.can_change(current, desired));
        }
        for actor in [User, Moderator, Admin, Owner] {
            for desired in [User, Moderator, Admin, Owner] {
                assert!(!actor.can_change(Owner, desired), "Owners are protected");
            }
            assert!(
                !actor.can_change(User, Owner),
                "Ownership requires manual provisioning"
            );
        }
        assert!(!Admin.can_change(Admin, Moderator));
        assert!(!Admin.can_change(Moderator, Admin));
        assert!(!Moderator.can_change(User, Moderator));
        assert!(!User.can_change(User, Admin));
        assert!(Owner.dashboard());
        assert!(Admin.dashboard());
        assert!(!Moderator.dashboard());
        assert!(!User.dashboard());
    }
}

#[derive(serde::Deserialize, serde::Serialize, Default)]
pub struct MetricsParams {
    pub days: Option<i64>,
    pub since: Option<chrono::DateTime<chrono::Utc>>,
    pub until: Option<chrono::DateTime<chrono::Utc>>,
    pub limit: Option<i64>,
    pub kind: Option<String>,
    pub offset: Option<u32>,
    pub search: Option<String>,
    pub sort: Option<String>,
    pub descending: Option<bool>,
    pub defaults: Option<bool>,
}
