module "function" {
  source = "../../modules/function"

  project     = var.project
  environment = "staging"
  image_tag   = var.image_tag
}
