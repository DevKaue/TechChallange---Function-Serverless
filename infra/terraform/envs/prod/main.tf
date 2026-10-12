module "function" {
  source = "../../modules/function"

  project     = var.project
  environment = "prod"
  image_tag   = var.image_tag
}
