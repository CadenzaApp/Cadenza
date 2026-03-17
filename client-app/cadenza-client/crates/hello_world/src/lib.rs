// You must call this once
uniffi::setup_scaffolding!();

#[uniffi::export]
pub fn greet(who: String) -> String {
    format!("Hello, {who}!")
}

#[derive(uniffi::Object)]
pub struct CoinToss {
    bias: f32,
}

#[uniffi::export]
impl CoinToss {
    #[uniffi::constructor]
    fn new() -> Self {
        Self { bias: 0.5 }
    }

    #[uniffi::constructor]
    fn with_bias(bias: f32) -> Self {
        Self { bias }
    }

    fn toss(&self) -> bool {
        rand::random::<f32>() < self.bias
    }
}
